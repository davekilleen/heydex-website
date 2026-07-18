import assert from 'node:assert/strict';
import test from 'node:test';

import { constants } from '../../scripts/explainers/direct-file-primitives.mjs';
import { createFixedSshSeams } from '../../scripts/explainers/direct-file-ssh-executor.mjs';

const transactionId = 'sealed-transaction';
const stageDirectory = `${constants.stateRoot}/staging/${transactionId}`;
const stagedTarget = `${stageDirectory}/${constants.directFilename}`;
const quarantineDirectory = `${constants.stateRoot}/transactions/${transactionId}/quarantine`;
const quarantineTarget = `${quarantineDirectory}/${constants.directFilename}`;
const target = `${constants.galleryRoot}/${constants.directFilename}`;

function stat(type = 'file') {
  return JSON.stringify({ exists: true, type, dev: 123, ino: 456, uid: 1000, gid: 1000, mode: type === 'directory' ? 0o700 : 0o644 });
}

function operation(command) {
  const match = command.match(/'((?:lstat|test-absent|realpath|read-file|statfs|mkdir|chmod|chown|fsync-directory|write-atomic|compare-and-swap-journal|rename-no-replace|remove-file))'/);
  return match?.[1];
}

test('fixed SSH executor exposes only sealed exact-path operations and uses a staged key', async () => {
  const calls = [];
  const seams = createFixedSshSeams({
    keyFile: '/var/tmp/staged-direct-file-key',
    host: 'publisher.example.test',
    user: 'publisher',
    run: async (command, args, options = {}) => {
      calls.push({ command, args, options, helperOperation: operation(args.at(-1)) });
      const op = operation(args.at(-1));
      if (op === 'lstat') return { stdout: stat('directory'), stderr: '' };
      if (op === 'read-file') return { stdout: Buffer.from('sealed bytes').toString('base64'), stderr: '' };
      if (op === 'realpath') return { stdout: `${constants.galleryRoot}\n`, stderr: '' };
      if (op === 'statfs') return { stdout: '4096 1\n', stderr: '' };
      if (op === 'compare-and-swap-journal') return { stdout: 'true\n', stderr: '' };
      return { stdout: '', stderr: '' };
    },
  });

  await seams.fs.lstat(constants.galleryRoot);
  assert.equal((await seams.executor.lstat(target)).exists, true);
  assert.equal(await seams.executor.testAbsent(target), true);
  assert.equal(await seams.fs.realpath(constants.galleryRoot), constants.galleryRoot);
  assert.deepEqual(await seams.fs.statfs(constants.galleryRoot), { bsize: 4096, bavail: 1 });
  await seams.fs.mkdir(stageDirectory, { mode: 0o700 });
  await seams.fs.chmod(stageDirectory, 0o700);
  await seams.fs.chown(stageDirectory, 1000, 1000);
  await seams.fs.fsyncDirectory(stageDirectory);
  assert.deepEqual(await seams.fs.readFile(stagedTarget), Buffer.from('sealed bytes'));
  await seams.fs.writeAtomic({ directory: stageDirectory, filename: constants.directFilename, contents: Buffer.from('upload body'), mode: 0o644, uid: 1000, gid: 1000, replace: false });
  assert.equal(await seams.fs.compareAndSwap({ directory: `${constants.stateRoot}/transactions/${transactionId}`, filename: 'transaction.json', expectedSha256: 'a'.repeat(64), contents: Buffer.from('updated journal'), mode: 0o600, uid: 1000, gid: 1000 }), true);
  await seams.fs.renameNoReplace(stagedTarget, target);
  await seams.fs.renameNoReplace(target, quarantineTarget);
  await seams.fs.rm(quarantineTarget);

  const operations = calls.map((call) => call.helperOperation);
  for (const required of ['lstat', 'test-absent', 'realpath', 'read-file', 'statfs', 'mkdir', 'chmod', 'chown', 'fsync-directory', 'write-atomic', 'compare-and-swap-journal', 'rename-no-replace', 'remove-file']) assert.ok(operations.includes(required), `missing ${required}`);
  for (const call of calls) {
    assert.equal(call.command, 'ssh');
    assert.deepEqual(call.args.slice(0, 6), ['-i', '/var/tmp/staged-direct-file-key', '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes']);
    assert.equal(call.args[6], '--');
    assert.equal(call.args[7], 'publisher@publisher.example.test');
    assert.doesNotMatch(call.args.at(-1), /index\.html|readdir|find\s|rm\s+-r|glob|recursive/);
  }
  assert.match(calls[0].args.at(-1), /fixed direct-file allowlist violation/);
  assert.equal(calls.find((call) => call.helperOperation === 'write-atomic').options.input.equals(Buffer.from('upload body')), true);
});

test('fixed SSH executor rejects shell, ancestor-mutation, arbitrary path, glob, and recursive surfaces', async () => {
  const seams = createFixedSshSeams({ keyFile: '/var/tmp/staged-direct-file-key', host: 'publisher.example.test', user: 'publisher', run: async () => ({ stdout: '', stderr: '' }) });
  await assert.rejects(() => seams.fs.lstat(`${constants.galleryRoot}/index.html`), /allowlist/);
  await assert.rejects(() => seams.fs.lstat(`${constants.galleryRoot}/another-child.html`), /allowlist/);
  await assert.rejects(() => seams.fs.mkdir('/var', { mode: 0o700 }), /allowlist/);
  await assert.rejects(() => seams.fs.chmod('/var/www', 0o700), /allowlist/);
  await assert.rejects(() => seams.fs.chown(constants.galleryRoot, 1000, 1000), /allowlist/);
  await assert.rejects(() => seams.fs.fsyncDirectory('/var'), /allowlist/);
  await assert.rejects(() => seams.fs.readFile(`${constants.stateRoot}/transactions/${transactionId}/unrelated.txt`), /allowlist/);
  await assert.rejects(() => seams.fs.writeAtomic({ directory: stageDirectory, filename: 'index.html', contents: Buffer.alloc(0), mode: 0o644, uid: 1000, gid: 1000 }), /allowlist/);
  await assert.rejects(() => seams.fs.compareAndSwap({ directory: `${constants.stateRoot}/transactions/${transactionId}`, filename: 'reviewed-direct-file.json', expectedSha256: 'a'.repeat(64), contents: Buffer.alloc(0), mode: 0o600, uid: 1000, gid: 1000 }), /allowlist/);
  await assert.rejects(() => seams.fs.renameNoReplace(stagedTarget, `${constants.galleryRoot}/unrelated.html`), /allowlist/);
  await assert.rejects(() => seams.fs.rm(`${constants.stateRoot}/transactions/${transactionId}/quarantine/*`), /allowlist/);
});
