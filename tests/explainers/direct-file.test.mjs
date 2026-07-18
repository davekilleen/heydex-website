import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  assertPreparedDirectFile,
  deserializeDirectFile,
  DIRECT_FILE_CSP,
  prepareDirectFile,
  serializableDirectFile,
  publishDirectFile,
  rollbackDirectFile,
} from '../../scripts/explainers/direct-file.mjs';
import { constants, createLocalExecutor, createNodeFilesystem, fixedTarget } from '../../scripts/explainers/direct-file-primitives.mjs';
import { createHash } from 'node:crypto';

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function artifact() {
  return Buffer.from(`<!doctype html>
<html lang="en"><head>
<meta http-equiv="Content-Security-Policy" content="${DIRECT_FILE_CSP}">
<title>Neutral direct artifact</title></head>
<body><main><h1>Neutral direct artifact</h1><p>Neutral local proof.</p></main></body></html>
`);
}
function metadata(bytes) {
  return { schemaVersion: 1, slug: 'dex-brain-vault-capability-architecture', title: 'Neutral direct artifact', summary: 'Neutral direct-file proof', createdAt: '2026-07-18T00:00:00.000Z', artifactSha256: sha256(bytes) };
}
function security() {
  return { web: { uid: process.getuid(), gid: process.getgid(), directoryMode: 0o755, fileMode: 0o644 }, state: { uid: process.getuid(), gid: process.getgid(), directoryMode: 0o700, fileMode: 0o600 }, minFreeBytes: 0 };
}
function preparedBytes(prepared) { return Buffer.from(prepared.artifactBytesBase64, 'base64'); }
async function fixture() {
  const root = await mkdtemp('/var/tmp/heydex-direct-file-focused-');
  const galleryRoot = path.join(root, 'gallery'); const stateRoot = path.join(root, 'state');
  await mkdir(galleryRoot, { mode: 0o755 }); await mkdir(stateRoot, { mode: 0o700 }); await chmod(galleryRoot, 0o755); await chmod(stateRoot, 0o700);
  await writeFile(path.join(galleryRoot, 'index.html'), 'shell bytes stay untouched\n', { mode: 0o644 }); await chmod(path.join(galleryRoot, 'index.html'), 0o644);
  await writeFile(path.join(galleryRoot, 'unrelated.html'), 'unrelated bytes\n', { mode: 0o644 }); await chmod(path.join(galleryRoot, 'unrelated.html'), 0o644);
  const bytes = artifact(); const prepared = prepareDirectFile({ artifactBytes: bytes, metadata: metadata(bytes) });
  const rawFs = createNodeFilesystem();
  const remap = (target) => target === '/var/www'
    ? root
    : target === constants.galleryRoot || target.startsWith(`${constants.galleryRoot}/`)
    ? path.join(galleryRoot, target.slice(constants.galleryRoot.length + 1))
    : target === constants.stateRoot || target.startsWith(`${constants.stateRoot}/`)
      ? path.join(stateRoot, target.slice(constants.stateRoot.length + 1))
      : target;
  const unmap = (target) => target === galleryRoot || target.startsWith(`${galleryRoot}/`)
    ? `${constants.galleryRoot}${target.slice(galleryRoot.length)}`
    : target === stateRoot || target.startsWith(`${stateRoot}/`)
      ? `${constants.stateRoot}${target.slice(stateRoot.length)}`
      : target;
  const fs = {
    chmod: (target, ...args) => rawFs.chmod(remap(target), ...args),
    chown: (target, ...args) => rawFs.chown(remap(target), ...args),
    fsyncDirectory: (target) => rawFs.fsyncDirectory(remap(target)),
    lstat: (target) => rawFs.lstat(remap(target)),
    mkdir: (target, ...args) => rawFs.mkdir(remap(target), ...args),
    readFile: (target, ...args) => rawFs.readFile(remap(target), ...args),
    realpath: async (target, ...args) => unmap(await rawFs.realpath(remap(target), ...args)),
    renameNoReplace: (source, target) => rawFs.renameNoReplace(remap(source), remap(target)),
    rm: (target, ...args) => rawFs.rm(remap(target), ...args),
    statfs: (target, ...args) => rawFs.statfs(remap(target), ...args),
    writeAtomic: ({ directory, ...args }) => rawFs.writeAtomic({ directory: remap(directory), ...args }),
  };
  const executor = createLocalExecutor(fs);
  return { root, galleryRoot, stateRoot, prepared, fs, executor, security: security() };
}
function current(prepared) { return { status: 200, body: preparedBytes(prepared), headers: { 'x-robots-tag': 'noindex, nofollow, noarchive' }, resources: [] }; }

test('receipt validation rejects hash drift, scripts, remote assets, and arbitrary target identity', () => {
  const bytes = artifact(); const prepared = prepareDirectFile({ artifactBytes: bytes, metadata: metadata(bytes), artifactBodyMarker: 'Neutral local proof' });
  assert.equal(prepared.filename, 'dex-brain-vault-capability-architecture.html');
  assert.equal(prepared.url, '/explainers/dex-brain-vault-capability-architecture.html');
  assert.equal('artifactBytes' in prepared, false);
  assert.deepEqual(JSON.parse(JSON.stringify(prepared)), prepared);
  assert.deepEqual(deserializeDirectFile(serializableDirectFile(prepared)), prepared);
  assertPreparedDirectFile(prepared);
  assert.throws(() => prepareDirectFile({ artifactBytes: Buffer.from('<!doctype html><html><head><script>x</script></head><body></body></html>'), metadata: metadata(Buffer.from('<!doctype html><html><head><script>x</script></head><body></body></html>')) }), /direct artifact/);
  const remote = Buffer.from(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${DIRECT_FILE_CSP}"><link href="https://example.test/a.css"></head><body></body></html>`);
  assert.throws(() => prepareDirectFile({ artifactBytes: remote, metadata: metadata(remote) }), /direct artifact/);
  const loose = Buffer.from(artifact().toString('utf8').replace(DIRECT_FILE_CSP, "default-src 'none'; style-src 'unsafe-inline'"));
  assert.throws(() => prepareDirectFile({ artifactBytes: loose, metadata: metadata(loose) }), /exact restrictive CSP/);
  const secret = Buffer.from(artifact().toString('utf8').replace('Neutral local proof.', 'api_key=not-for-publication'));
  assert.throws(() => prepareDirectFile({ artifactBytes: secret, metadata: metadata(secret) }), /secret-shaped/);
  assert.throws(() => assertPreparedDirectFile({ ...prepared, filename: 'index.html' }), /fixed identity/);
});

test('focused publish and rollback touch only the fixed target and tolerate unrelated child changes', async (t) => {
  const value = await fixture(); t.after(() => rm(value.root, { recursive: true, force: true }));
  const shellBefore = await readFile(path.join(value.galleryRoot, 'index.html')); const unrelatedBefore = await readFile(path.join(value.galleryRoot, 'unrelated.html'));
  const remoteProbes = [];
  const executor = {
    async lstat(target) { remoteProbes.push(['lstat', target]); return value.executor.lstat(target); },
    async testAbsent(target) { remoteProbes.push(['test-absent', target]); return value.executor.testAbsent(target); },
  };
  const published = await publishDirectFile({ prepared: value.prepared, galleryRoot: constants.galleryRoot, stateRoot: constants.stateRoot, transactionId: 'focused-transaction', security: value.security, fs: value.fs, executor, postPublishVerifier: async () => { await writeFile(path.join(value.galleryRoot, 'concurrent.html'), 'created concurrently\n', { mode: 0o644 }); await chmod(path.join(value.galleryRoot, 'concurrent.html'), 0o644); return current(value.prepared); } });
  assert.equal(published.journal.phase, 'published'); assert.equal(published.journal.externalVerification.status, 'verified');
  assert.equal(published.journal.externalVerification.responseStatus, 200);
  assert.equal(published.journal.targetPath, `${constants.galleryRoot}/${constants.directFilename}`);
  assert.deepEqual(published.journal.artifactIdentity, { type: 'regular', uid: process.getuid(), gid: process.getgid(), mode: 0o644 });
  assert.equal((await readFile(fixedTarget(value.galleryRoot))).equals(preparedBytes(value.prepared)), true);
  assert.deepEqual(await readFile(path.join(value.galleryRoot, 'index.html')), shellBefore); assert.deepEqual(await readFile(path.join(value.galleryRoot, 'unrelated.html')), unrelatedBefore);
  const rolled = await rollbackDirectFile({ galleryRoot: constants.galleryRoot, stateRoot: constants.stateRoot, transactionId: published.transactionId, security: value.security, fs: value.fs, executor, authenticatedVerifier: async ({ phase }) => phase === 'before-rollback' ? current(value.prepared) : { status: 200, body: '<!doctype html><title>shell fallback</title>' } });
  assert.equal(rolled.journal.phase, 'rolled-back'); assert.equal(rolled.journal.externalVerification.status, 'verified');
  assert.equal(rolled.journal.externalVerification.responseStatus, 200);
  assert.ok(remoteProbes.some(([name]) => name === 'lstat' && remoteProbes.find(([other]) => other === 'test-absent')));
  await assert.rejects(() => value.fs.lstat(fixedTarget(value.galleryRoot)), { code: 'ENOENT' });
  assert.deepEqual(await readFile(path.join(value.galleryRoot, 'index.html')), shellBefore); assert.deepEqual(await readFile(path.join(value.galleryRoot, 'unrelated.html')), unrelatedBefore);
});

test('unrelated child removal is ignored by the fixed transaction', async (t) => {
  const value = await fixture(); t.after(() => rm(value.root, { recursive: true, force: true }));
  const published = await publishDirectFile({ prepared: value.prepared, transactionId: 'unrelated-removal', security: value.security, fs: value.fs, executor: value.executor, postPublishVerifier: async () => {
    await rm(path.join(value.galleryRoot, 'unrelated.html'));
    return current(value.prepared);
  } });
  assert.equal(published.journal.phase, 'published');
  const rolled = await rollbackDirectFile({ transactionId: published.transactionId, security: value.security, fs: value.fs, executor: value.executor });
  assert.equal(rolled.journal.phase, 'rolled-back');
});

test('rollback ignores unavailable external verification but refuses server identity drift', async (t) => {
  const value = await fixture(); t.after(() => rm(value.root, { recursive: true, force: true }));
  const published = await publishDirectFile({ prepared: value.prepared, galleryRoot: constants.galleryRoot, stateRoot: constants.stateRoot, transactionId: 'identity-transaction', security: value.security, fs: value.fs, executor: value.executor });
  await writeFile(fixedTarget(value.galleryRoot), 'drifted bytes\n', { mode: 0o644 }); await chmod(fixedTarget(value.galleryRoot), 0o644);
  await assert.rejects(() => rollbackDirectFile({ galleryRoot: constants.galleryRoot, stateRoot: constants.stateRoot, transactionId: published.transactionId, security: value.security, fs: value.fs, executor: value.executor, authenticatedVerifier: async () => { throw new Error('HTTPS unavailable'); } }), /identity drift/);
  await writeFile(fixedTarget(value.galleryRoot), preparedBytes(value.prepared), { mode: 0o644 }); await chmod(fixedTarget(value.galleryRoot), 0o644);
  const rolled = await rollbackDirectFile({ galleryRoot: constants.galleryRoot, stateRoot: constants.stateRoot, transactionId: published.transactionId, security: value.security, fs: value.fs, executor: value.executor, authenticatedVerifier: async () => { throw new Error('HTTPS unavailable'); } });
  assert.equal(rolled.journal.phase, 'rolled-back'); assert.equal(rolled.journal.externalVerification.status, 'pending');
});

test('external response policy rejects missing noindex and invalid former-route statuses', async (t) => {
  const value = await fixture(); t.after(() => rm(value.root, { recursive: true, force: true }));
  await assert.rejects(() => publishDirectFile({
    prepared: value.prepared,
    galleryRoot: constants.galleryRoot,
    stateRoot: constants.stateRoot,
    transactionId: 'missing-robots',
    security: value.security,
    fs: value.fs,
    executor: value.executor,
    postPublishVerifier: async () => ({ status: 200, body: preparedBytes(value.prepared), headers: {}, resources: [] }),
  }), /external direct-file verification failed/);
  await assert.rejects(() => value.fs.lstat(fixedTarget(constants.galleryRoot)), { code: 'ENOENT' });
  const unavailable = await fixture(); t.after(() => rm(unavailable.root, { recursive: true, force: true }));
  await assert.rejects(() => publishDirectFile({ prepared: unavailable.prepared, transactionId: 'unavailable-publish', security: unavailable.security, fs: unavailable.fs, executor: unavailable.executor, postPublishVerifier: async () => { throw new Error('HTTPS unavailable'); } }), /external direct-file verification failed/);
  await assert.rejects(() => unavailable.fs.lstat(fixedTarget(constants.galleryRoot)), { code: 'ENOENT' });
  const value2 = await fixture(); t.after(() => rm(value2.root, { recursive: true, force: true }));
  const published = await publishDirectFile({ prepared: value2.prepared, galleryRoot: constants.galleryRoot, stateRoot: constants.stateRoot, transactionId: 'invalid-former-status', security: value2.security, fs: value2.fs, executor: value2.executor });
  const rolled = await rollbackDirectFile({ galleryRoot: constants.galleryRoot, stateRoot: constants.stateRoot, transactionId: published.transactionId, security: value2.security, fs: value2.fs, executor: value2.executor, authenticatedVerifier: async ({ phase }) => phase === 'after-rollback' ? { status: 500, body: 'upstream failure' } : current(value2.prepared) });
  assert.equal(rolled.journal.externalVerification.status, 'failed');
});

test('promotion-boundary failure is recovered by the synced journal without addressing the shell', async (t) => {
  const value = await fixture(); t.after(() => rm(value.root, { recursive: true, force: true }));
  await assert.rejects(() => publishDirectFile({ prepared: value.prepared, galleryRoot: constants.galleryRoot, stateRoot: constants.stateRoot, transactionId: 'crash-transaction', security: value.security, fs: value.fs, executor: value.executor, phaseHook: async (phase) => { if (phase === 'promoted') throw new Error('simulated crash'); } }), /simulated crash/);
  await assert.rejects(() => value.fs.lstat(fixedTarget(value.galleryRoot)), { code: 'ENOENT' });
  assert.deepEqual(await readFile(path.join(value.galleryRoot, 'index.html')), Buffer.from('shell bytes stay untouched\n'));
});

test('upload-boundary failure removes only the staged fixed file', async (t) => {
  const value = await fixture(); t.after(() => rm(value.root, { recursive: true, force: true }));
  const transactionId = 'upload-boundary';
  await assert.rejects(() => publishDirectFile({
    prepared: value.prepared,
    galleryRoot: constants.galleryRoot,
    stateRoot: constants.stateRoot,
    transactionId,
    security: value.security,
    fs: value.fs,
    executor: value.executor,
    phaseHook: async (phase) => { if (phase === 'uploaded') throw new Error('simulated upload boundary'); },
  }), /simulated upload boundary/);
  await assert.rejects(() => value.fs.lstat(path.join(value.stateRoot, 'staging', transactionId, value.prepared.filename)), { code: 'ENOENT' });
  await assert.rejects(() => value.fs.lstat(fixedTarget(value.galleryRoot)), { code: 'ENOENT' });
  assert.deepEqual(await readFile(path.join(value.galleryRoot, 'index.html')), Buffer.from('shell bytes stay untouched\n'));
});

test('quarantine-boundary failure leaves recoverable evidence and the retry removes only the fixed file', async (t) => {
  const value = await fixture(); t.after(() => rm(value.root, { recursive: true, force: true }));
  const transactionId = 'quarantine-boundary';
  const published = await publishDirectFile({ prepared: value.prepared, galleryRoot: constants.galleryRoot, stateRoot: constants.stateRoot, transactionId, security: value.security, fs: value.fs, executor: value.executor });
  await assert.rejects(() => rollbackDirectFile({ galleryRoot: constants.galleryRoot, stateRoot: constants.stateRoot, transactionId: published.transactionId, security: value.security, fs: value.fs, executor: value.executor, phaseHook: async (phase) => { if (phase === 'artifact-quarantined') throw new Error('simulated quarantine boundary'); } }), /simulated quarantine boundary/);
  await assert.rejects(() => value.fs.lstat(fixedTarget(value.galleryRoot)), { code: 'ENOENT' });
  const quarantine = path.join(value.stateRoot, 'transactions', transactionId, 'quarantine', value.prepared.filename);
  assert.equal((await value.fs.lstat(quarantine)).isFile(), true);
  const rolled = await rollbackDirectFile({ galleryRoot: constants.galleryRoot, stateRoot: constants.stateRoot, transactionId: published.transactionId, security: value.security, fs: value.fs, executor: value.executor });
  assert.equal(rolled.journal.phase, 'rolled-back');
  await assert.rejects(() => value.fs.lstat(quarantine), { code: 'ENOENT' });
  assert.deepEqual(await readFile(path.join(value.galleryRoot, 'index.html')), Buffer.from('shell bytes stay untouched\n'));
});

test('focused command source contains no gallery import, index operation, root enumeration, or root-wide lease', async () => {
  const source = await readFile(new URL('../../scripts/explainers/direct-file.mjs', import.meta.url), 'utf8');
  const primitives = await readFile(new URL('../../scripts/explainers/direct-file-primitives.mjs', import.meta.url), 'utf8');
  assert.match(source, /assertFixedRemoteRoots/);
  assert.doesNotMatch(source, /gallery-index|publisher\.mjs|index\.html|readdir|withLock|locks/);
  assert.doesNotMatch(primitives, /gallery-index|publisher\.mjs|index\.html|readdir|withLock|locks|recursive:\s*true|glob|wildcard/);
});
