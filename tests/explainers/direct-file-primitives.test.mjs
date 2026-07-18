import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  assertTargetAbsent,
  assertFixedRemoteRoots,
  constants,
  createLocalExecutor,
  createNodeFilesystem,
  createSshExecutor,
  fixedTarget,
  preflightFixedRoots,
  stageCliKeyFile,
} from '../../scripts/explainers/direct-file-primitives.mjs';

const security = () => ({
  web: { uid: process.getuid(), gid: process.getgid(), directoryMode: 0o755, fileMode: 0o644 },
  state: { uid: process.getuid(), gid: process.getgid(), directoryMode: 0o700, fileMode: 0o600 },
  minFreeBytes: 0,
});
const executeFile = promisify(execFile);

async function roots() {
  const root = await mkdtemp('/var/tmp/heydex-direct-primitives-');
  const galleryRoot = path.join(root, 'gallery');
  const stateRoot = path.join(root, 'state');
  await mkdir(galleryRoot, { mode: 0o755 });
  await mkdir(stateRoot, { mode: 0o700 });
  await chmod(galleryRoot, 0o755); await chmod(stateRoot, 0o700);
  return { root, galleryRoot, stateRoot, fs: createNodeFilesystem(), security: security() };
}

test('fixed paths reject index, arbitrary children, traversal, and unauthorized slugs', async (t) => {
  const value = await roots();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  assert.equal(fixedTarget(value.galleryRoot), path.join(value.galleryRoot, constants.directFilename));
  assert.throws(() => fixedTarget(value.galleryRoot, 'other-slug'), /outside the authorized/);
  assert.throws(() => fixedTarget(value.galleryRoot, '../index'), /outside the authorized/);
  const executor = createSshExecutor({ keyFile: '/var/tmp/key', host: 'example.test', user: 'deploy', run: async () => ({}) });
  await assert.rejects(() => executor.lstat('/var/www/explainers/index.html'), /allowlist/);
  await assert.rejects(() => executor.lstat('/var/www/heydex/other.html'), /allowlist/);
  assert.deepEqual(assertFixedRemoteRoots('/var/www/explainers', '/var/www/.heydex-explainer-publisher'), { galleryRoot: '/var/www/explainers', stateRoot: '/var/www/.heydex-explainer-publisher' });
  assert.throws(() => assertFixedRemoteRoots('/var/tmp/gallery', '/var/tmp/state'), /fixed and cannot be overridden/);
});

test('SSH executor emits only the fixed target command', async () => {
  const calls = [];
  const executor = createSshExecutor({ keyFile: '/var/tmp/key', host: 'example.test', user: 'deploy', run: async (...args) => { calls.push(args); return { exists: false }; } });
  await executor.lstat('/var/www/explainers/dex-brain-vault-capability-architecture.html');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][0], 'ssh');
  assert.deepEqual(calls[0][1].slice(-3), ['heydex-explainer-publisher', 'lstat', '/var/www/explainers/dex-brain-vault-capability-architecture.html']);
});

test('fixed preflight validates only canonical roots and target absence proves both probes', async (t) => {
  const value = await roots();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  await preflightFixedRoots({ fs: value.fs, galleryRoot: value.galleryRoot, stateRoot: value.stateRoot, security: value.security, requiredBytes: 0 });
  const calls = [];
  const executor = {
    async lstat(target) { calls.push(['lstat', target]); return { exists: false }; },
    async testAbsent(target) { calls.push(['test-absent', target]); return true; },
  };
  await assertTargetAbsent({ fs: value.fs, executor, galleryRoot: value.galleryRoot });
  assert.deepEqual(calls.map(([name]) => name), ['lstat', 'test-absent']);
  await writeFile(fixedTarget(value.galleryRoot), 'collision', { mode: 0o644 });
  await assert.rejects(() => assertTargetAbsent({ fs: value.fs, executor, galleryRoot: value.galleryRoot }), /already exists/);
});

test('preflight rejects roots on different filesystem devices', async (t) => {
  const value = await roots();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const base = value.fs;
  const spoofed = {
    ...base,
    async lstat(target) {
      const stat = await base.lstat(target);
      if (target === value.stateRoot) {
        const fake = Object.create(Object.getPrototypeOf(stat));
        Object.assign(fake, stat, { dev: stat.dev + 1 });
        return fake;
      }
      return stat;
    },
  };
  await assert.rejects(() => preflightFixedRoots({ fs: spoofed, galleryRoot: value.galleryRoot, stateRoot: value.stateRoot, security: value.security, requiredBytes: 0 }), /same filesystem device/);
});

test('strict CLI key staging copies only a current-user-owned 0600 key and cleans up', async (t) => {
  const root = await mkdtemp('/var/tmp/heydex-direct-key-test-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'key');
  await executeFile('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', source], { maxBuffer: 1024 });
  const keyText = await readFile(source, 'utf8');
  const match = /^(-----BEGIN OPENSSH PRIVATE KEY-----)\s*([\s\S]*?)\s*(-----END OPENSSH PRIVATE KEY-----)\s*$/.exec(keyText);
  assert.ok(match);
  await writeFile(source, `${match[1]} ${match[2].replace(/\s/g, '')} ${match[3]}`, { mode: 0o600 });
  await chmod(source, 0o600);
  const staged = await stageCliKeyFile(source);
  try {
    assert.notEqual(staged.keyFile, source);
    assert.match(await readFile(staged.keyFile, 'utf8'), /^-----BEGIN OPENSSH PRIVATE KEY-----\n[A-Za-z0-9+/=\n]+-----END OPENSSH PRIVATE KEY-----\n$/);
    const stat = await lstat(staged.keyFile);
    assert.equal(stat.uid, process.getuid());
    assert.equal(stat.gid, process.getgid());
    assert.equal(stat.mode & 0o777, 0o600);
  } finally {
    await staged.cleanup();
  }
  await assert.rejects(() => lstat(staged.keyFile), { code: 'ENOENT' });
  await chmod(source, 0o644);
  await assert.rejects(() => stageCliKeyFile(source), /0600 regular file/);
});

test('no-replace rename preserves an existing fixed target', async (t) => {
  const value = await roots();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const stageRoot = path.join(value.root, 'stage');
  await mkdir(stageRoot, { mode: 0o700 });
  await chmod(stageRoot, 0o700);
  const source = path.join(stageRoot, constants.directFilename);
  const target = fixedTarget(value.galleryRoot);
  await writeFile(source, 'new bytes\n', { mode: 0o644 });
  await writeFile(target, 'existing bytes\n', { mode: 0o644 });
  await assert.rejects(() => value.fs.renameNoReplace(source, target), /EEXIST|already exists/);
  assert.deepEqual(await readFile(source), Buffer.from('new bytes\n'));
  assert.deepEqual(await readFile(target), Buffer.from('existing bytes\n'));
});

test('preflight refuses symlinked roots and unsafe root modes', async (t) => {
  const value = await roots();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const linked = path.join(value.root, 'linked-gallery');
  await symlink(value.galleryRoot, linked);
  await assert.rejects(() => preflightFixedRoots({ fs: value.fs, galleryRoot: linked, stateRoot: value.stateRoot, security: value.security, requiredBytes: 0 }), /symbolic-link/);
  await chmod(value.galleryRoot, 0o775);
  await assert.rejects(() => preflightFixedRoots({ fs: value.fs, galleryRoot: value.galleryRoot, stateRoot: value.stateRoot, security: value.security, requiredBytes: 0 }), /mode/);
});
