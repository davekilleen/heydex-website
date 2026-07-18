import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  assertFixedRemoteRoots,
  assertTargetAbsent,
  assertTransactionPaths,
  constants,
  createLocalExecutor,
  createNodeFilesystem,
  fixedTarget,
  preflightFixedRoots,
  stageCliKeyFile,
  transactionPaths,
} from '../../scripts/explainers/direct-file-primitives.mjs';

const executeFile = promisify(execFile);

function security() {
  return {
    web: { uid: process.getuid(), gid: process.getgid(), directoryMode: 0o755, fileMode: 0o644 },
    state: { uid: process.getuid(), gid: process.getgid(), directoryMode: 0o700, fileMode: 0o600 },
    minFreeBytes: 0,
  };
}

async function roots() {
  const root = await mkdtemp('/var/tmp/heydex-direct-primitives-');
  const galleryRoot = path.join(root, 'gallery');
  const stateRoot = path.join(root, 'state');
  await mkdir(galleryRoot, { mode: 0o755 });
  await mkdir(stateRoot, { mode: 0o700 });
  await chmod(galleryRoot, 0o755); await chmod(stateRoot, 0o700);
  const fs = createNodeFilesystem();
  return { root, galleryRoot, stateRoot, fs, security: security() };
}

async function nestedState(value, transactionId = 'nested-check') {
  const paths = transactionPaths(value.galleryRoot, value.stateRoot, transactionId);
  await mkdir(paths.transactionsRoot, { mode: 0o700 });
  await mkdir(paths.stagingRoot, { mode: 0o700 });
  await mkdir(paths.transactionRoot, { mode: 0o700 });
  await mkdir(paths.stageDirectory, { mode: 0o700 });
  for (const target of [paths.transactionsRoot, paths.stagingRoot, paths.transactionRoot, paths.stageDirectory]) await chmod(target, 0o700);
  const gallery = await value.fs.lstat(value.galleryRoot);
  return { paths, roots: { galleryRoot: value.galleryRoot, stateRoot: value.stateRoot, device: gallery.dev } };
}

test('fixed roots and target builder reject arbitrary slugs, traversal, and root overrides', async (t) => {
  const value = await roots();
  t.after(() => rm(value.root, { recursive: true, force: true }));

  assert.equal(fixedTarget(value.galleryRoot), path.join(value.galleryRoot, constants.directFilename));
  assert.throws(() => fixedTarget(value.galleryRoot, 'other-slug'), /outside the authorized/);
  assert.throws(() => fixedTarget(value.galleryRoot, '../index'), /outside the authorized/);
  assert.deepEqual(assertFixedRemoteRoots(constants.galleryRoot, constants.stateRoot), { galleryRoot: constants.galleryRoot, stateRoot: constants.stateRoot });
  assert.throws(() => assertFixedRemoteRoots(value.galleryRoot, value.stateRoot), /fixed and cannot be overridden/);
});

test('canonical root preflight and double absence probes use only the exact target', async (t) => {
  const value = await roots();
  t.after(() => rm(value.root, { recursive: true, force: true }));

  const rootInfo = await preflightFixedRoots({ fs: value.fs, galleryRoot: value.galleryRoot, stateRoot: value.stateRoot, security: value.security, requiredBytes: 0 });
  assert.equal(rootInfo.device, (await value.fs.lstat(value.galleryRoot)).dev);
  const calls = [];
  const executor = {
    async lstat(target) { calls.push(['lstat', target]); return { exists: false }; },
    async testAbsent(target) { calls.push(['test-absent', target]); return true; },
  };
  await assertTargetAbsent({ fs: value.fs, executor, galleryRoot: value.galleryRoot });
  assert.deepEqual(calls, [
    ['lstat', fixedTarget(value.galleryRoot)],
    ['test-absent', fixedTarget(value.galleryRoot)],
  ]);

  await writeFile(fixedTarget(value.galleryRoot), 'collision', { mode: 0o644 });
  await chmod(fixedTarget(value.galleryRoot), 0o644);
  await assert.rejects(() => assertTargetAbsent({ fs: value.fs, executor, galleryRoot: value.galleryRoot }), /already exists/);
});

test('nested transaction and quarantine symlink parents fail before a mutation can follow', async (t) => {
  const transactionParent = await roots();
  t.after(() => rm(transactionParent.root, { recursive: true, force: true }));
  const transactionId = 'symlink-transaction';
  const txPaths = transactionPaths(transactionParent.galleryRoot, transactionParent.stateRoot, transactionId);
  await mkdir(txPaths.stagingRoot, { mode: 0o700 }); await chmod(txPaths.stagingRoot, 0o700);
  const outside = path.join(transactionParent.root, 'outside-transactions');
  await mkdir(outside, { mode: 0o700 }); await chmod(outside, 0o700);
  await symlink(outside, txPaths.transactionsRoot);
  const gallery = await transactionParent.fs.lstat(transactionParent.galleryRoot);
  await assert.rejects(
    () => assertTransactionPaths({ fs: transactionParent.fs, roots: { galleryRoot: transactionParent.galleryRoot, stateRoot: transactionParent.stateRoot, device: gallery.dev }, transactionId, security: transactionParent.security }),
    /symbolic[ -]link/,
  );

  const quarantineParent = await roots();
  t.after(() => rm(quarantineParent.root, { recursive: true, force: true }));
  const { paths, roots: canonicalRoots } = await nestedState(quarantineParent, 'symlink-quarantine');
  const outsideQuarantine = path.join(quarantineParent.root, 'outside-quarantine');
  await mkdir(outsideQuarantine, { mode: 0o700 }); await chmod(outsideQuarantine, 0o700);
  await symlink(outsideQuarantine, paths.quarantineDirectory);
  await assert.rejects(
    () => assertTransactionPaths({ fs: quarantineParent.fs, roots: canonicalRoots, transactionId: 'symlink-quarantine', security: quarantineParent.security, requireTransaction: true, requireQuarantine: true }),
    /symbolic[ -]link/,
  );
});

test('nested transaction paths reject a cross-device staging or quarantine seam', async (t) => {
  const value = await roots();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const { paths, roots: canonicalRoots } = await nestedState(value, 'cross-device-nested');
  await mkdir(paths.quarantineDirectory, { mode: 0o700 }); await chmod(paths.quarantineDirectory, 0o700);
  const base = value.fs;
  const fakeFs = {
    ...base,
    async lstat(target) {
      const stat = await base.lstat(target);
      if (target === paths.quarantineDirectory) {
        const replacement = Object.create(Object.getPrototypeOf(stat));
        Object.assign(replacement, stat, { dev: stat.dev + 1 });
        return replacement;
      }
      return stat;
    },
  };
  await assert.rejects(
    () => assertTransactionPaths({ fs: fakeFs, roots: canonicalRoots, transactionId: 'cross-device-nested', security: value.security, requireTransaction: true, requireStage: true, requireQuarantine: true }),
    /gallery filesystem device/,
  );
});

test('preflight rejects cross-device roots, symlinked roots, and unsafe root modes', async (t) => {
  const value = await roots();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const base = value.fs;
  const spoofed = {
    ...base,
    async lstat(target) {
      const stat = await base.lstat(target);
      if (target === value.stateRoot) {
        const replacement = Object.create(Object.getPrototypeOf(stat));
        Object.assign(replacement, stat, { dev: stat.dev + 1 });
        return replacement;
      }
      return stat;
    },
  };
  await assert.rejects(() => preflightFixedRoots({ fs: spoofed, galleryRoot: value.galleryRoot, stateRoot: value.stateRoot, security: value.security, requiredBytes: 0 }), /same filesystem device/);

  const linked = path.join(value.root, 'linked-gallery');
  await symlink(value.galleryRoot, linked);
  await assert.rejects(() => preflightFixedRoots({ fs: value.fs, galleryRoot: linked, stateRoot: value.stateRoot, security: value.security, requiredBytes: 0 }), /symbolic[ -]link/);
  await chmod(value.galleryRoot, 0o775);
  await assert.rejects(() => preflightFixedRoots({ fs: value.fs, galleryRoot: value.galleryRoot, stateRoot: value.stateRoot, security: value.security, requiredBytes: 0 }), /mode/);
});

test('strict CLI key staging requires a current-user-owned 0600 regular key and cleans it up', async (t) => {
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
    assert.equal((await lstat(staged.keyFile)).mode & 0o777, 0o600);
  } finally {
    await staged.cleanup();
  }
  await assert.rejects(() => lstat(staged.keyFile), { code: 'ENOENT' });
  await chmod(source, 0o644);
  await assert.rejects(() => stageCliKeyFile(source), /0600 regular file/);
});

test('no-replace rename preserves both source and an existing target', async (t) => {
  const value = await roots();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const stageRoot = path.join(value.root, 'stage');
  await mkdir(stageRoot, { mode: 0o700 }); await chmod(stageRoot, 0o700);
  const source = path.join(stageRoot, constants.directFilename);
  const target = fixedTarget(value.galleryRoot);
  await writeFile(source, 'new bytes\n', { mode: 0o644 }); await chmod(source, 0o644);
  await writeFile(target, 'existing bytes\n', { mode: 0o644 }); await chmod(target, 0o644);
  await assert.rejects(() => value.fs.renameNoReplace(source, target), /EEXIST|already exists/);
  assert.deepEqual(await readFile(source), Buffer.from('new bytes\n'));
  assert.deepEqual(await readFile(target), Buffer.from('existing bytes\n'));
  assert.equal((await createLocalExecutor(value.fs).testAbsent(target)), false);
});
