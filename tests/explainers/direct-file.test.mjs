import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  assertPreparedDirectFile,
  deserializeDirectFile,
  DIRECT_FILE_CSP,
  DIRECT_FILE_URL,
  prepareDirectFile,
  publishDirectFile,
  rollbackDirectFile,
  runCli,
  serializableDirectFile,
  validateVerificationEvidence,
} from '../../scripts/explainers/direct-file.mjs';
import { constants, createLocalExecutor, createNodeFilesystem, fixedTarget } from '../../scripts/explainers/direct-file-primitives.mjs';

const NOW = '2026-07-18T12:00:00.000Z';
const now = () => new Date(NOW);

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function artifact({ head = '', body = '<main><h1>Neutral direct artifact</h1><p>Neutral local proof.</p></main>' } = {}) {
  return Buffer.from(`<!doctype html>
<html lang="en"><head>
<meta http-equiv="Content-Security-Policy" content="${DIRECT_FILE_CSP}">
<title>Neutral direct artifact</title>${head}</head>
<body>${body}</body></html>
`);
}
function metadata(bytes) {
  return {
    schemaVersion: 1,
    slug: constants.directSlug,
    title: 'Neutral direct artifact',
    summary: 'Neutral direct-file proof',
    createdAt: '2026-07-18T00:00:00.000Z',
    artifactSha256: sha256(bytes),
  };
}
function security() {
  return {
    web: { uid: process.getuid(), gid: process.getgid(), directoryMode: 0o755, fileMode: 0o644 },
    state: { uid: process.getuid(), gid: process.getgid(), directoryMode: 0o700, fileMode: 0o600 },
    minFreeBytes: 0,
  };
}
function preparedBytes(prepared) { return Buffer.from(prepared.artifactBytesBase64, 'base64'); }
function evidence(prepared, overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'direct-file-verification',
    url: DIRECT_FILE_URL,
    artifactSha256: prepared.artifactSha256,
    artifactSize: prepared.artifactSize,
    capturedAt: NOW,
    authenticated: {
      status: 200,
      bodySha256: prepared.artifactSha256,
      bodySize: prepared.artifactSize,
      xRobotsTag: 'noindex, nofollow, noarchive',
      requestUrls: [DIRECT_FILE_URL],
    },
    unauthenticated: {
      status: 302,
      bodySha256: '0'.repeat(64),
      artifactLeaked: false,
      requestUrls: [DIRECT_FILE_URL],
      location: 'https://heydex.ai/oauth2/sign_in',
    },
    ...overrides,
  };
}

function remappedFilesystem(root, galleryRoot, stateRoot) {
  const rawFs = createNodeFilesystem();
  const remap = (target) => target === '/var/www'
    ? root
    : target === constants.galleryRoot || target.startsWith(`${constants.galleryRoot}/`)
      ? path.join(galleryRoot, target.slice(constants.galleryRoot.length + 1))
      : target === constants.stateRoot || target.startsWith(`${constants.stateRoot}/`)
        ? path.join(stateRoot, target.slice(constants.stateRoot.length + 1))
        : target;
  const unmap = (target) => target === root
    ? '/var/www'
    : target === galleryRoot || target.startsWith(`${galleryRoot}/`)
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
  return { fs, remap };
}

function mutationSpy(fs) {
  const calls = [];
  const mutations = ['mkdir', 'writeAtomic', 'chmod', 'chown', 'renameNoReplace', 'rm', 'fsyncDirectory'];
  return {
    calls,
    fs: Object.fromEntries(Object.entries(fs).map(([name, method]) => [name, mutations.includes(name)
      ? async (...args) => { calls.push({ name, args }); return method(...args); }
      : method])),
  };
}

async function fixture() {
  const root = await mkdtemp('/var/tmp/heydex-direct-file-focused-');
  const galleryRoot = path.join(root, 'gallery');
  const stateRoot = path.join(root, 'state');
  await mkdir(galleryRoot, { mode: 0o755 }); await mkdir(stateRoot, { mode: 0o700 });
  await chmod(galleryRoot, 0o755); await chmod(stateRoot, 0o700);
  const shell = path.join(galleryRoot, 'index.html');
  const unrelated = path.join(galleryRoot, 'unrelated.html');
  await writeFile(shell, 'shell bytes stay untouched\n', { mode: 0o644 }); await chmod(shell, 0o644);
  await writeFile(unrelated, 'unrelated bytes\n', { mode: 0o644 }); await chmod(unrelated, 0o644);
  const bytes = artifact();
  const prepared = prepareDirectFile({ artifactBytes: bytes, metadata: metadata(bytes), artifactBodyMarker: 'Neutral local proof.' });
  const { fs, remap } = remappedFilesystem(root, galleryRoot, stateRoot);
  return { root, galleryRoot, stateRoot, shell, unrelated, prepared, fs, remap, executor: createLocalExecutor(fs), security: security() };
}

async function publish(value, transactionId, options = {}) {
  return publishDirectFile({
    prepared: value.prepared,
    transactionId,
    security: value.security,
    fs: value.fs,
    executor: value.executor,
    verificationEvidence: evidence(value.prepared),
    now,
    ...options,
  });
}

test('receipt accepts the fixed full URL and valid data image while rejecting malformed, executable, navigation, and refresh markup', () => {
  const valid = artifact({ body: '<main><img alt="neutral" src="data:image/png;base64,AA=="><p>Neutral local proof.</p></main>' });
  const prepared = prepareDirectFile({ artifactBytes: valid, metadata: metadata(valid), artifactBodyMarker: 'Neutral local proof.' });
  assert.equal(prepared.filename, constants.directFilename);
  assert.equal(prepared.url, DIRECT_FILE_URL);
  assert.equal('artifactBytes' in prepared, false);
  assert.deepEqual(deserializeDirectFile(serializableDirectFile(prepared)), prepared);
  assertPreparedDirectFile(prepared);

  const invalidArtifacts = [
    artifact({ head: '<meta http-equiv="refresh" content="0; url=https://example.test">' }),
    artifact({ body: '<a href="https://example.test">leave</a>' }),
    artifact({ body: '<form action="https://example.test"><button>submit</button></form>' }),
    artifact({ head: '<base href="https://example.test/">' }),
    artifact({ body: '<iframe src="https://example.test"></iframe>' }),
    artifact({ body: '<img srcset="https://example.test/a.png 1x">' }),
    artifact({ body: '<script>fetch("https://example.test")</script>' }),
    Buffer.from(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${DIRECT_FILE_CSP}"></head><body><main>broken</main></html>`),
  ];
  for (const invalid of invalidArtifacts) {
    assert.throws(() => prepareDirectFile({ artifactBytes: invalid, metadata: metadata(invalid) }), /direct artifact/);
  }
  const secret = artifact({ body: '<main>api_key=not-for-publication</main>' });
  assert.throws(() => prepareDirectFile({ artifactBytes: secret, metadata: metadata(secret) }), /secret-shaped/);
  assert.throws(() => assertPreparedDirectFile({ ...prepared, filename: 'index.html' }), /fixed identity/);
});

test('accepted parser policy plus a loopback request proof permits only the document request', async () => {
  const bytes = artifact();
  const prepared = prepareDirectFile({ artifactBytes: bytes, metadata: metadata(bytes) });
  assert.equal(prepared.artifactSha256, sha256(bytes));
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(bytes);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/artifact.html`);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  assert.deepEqual(requests, ['GET /artifact.html']);
});

test('verification evidence binds a current exact body/hash, noindex, no-third-party request set, and unauthenticated redirect', () => {
  const bytes = artifact();
  const prepared = prepareDirectFile({ artifactBytes: bytes, metadata: metadata(bytes) });
  assert.deepEqual(validateVerificationEvidence(evidence(prepared), prepared, now), evidence(prepared));
  const invalid = [
    undefined,
    evidence(prepared, { url: 'https://heydex.ai/explainers/other.html' }),
    evidence(prepared, { capturedAt: '2026-07-18T11:00:00.000Z' }),
    evidence(prepared, { authenticated: { ...evidence(prepared).authenticated, xRobotsTag: 'noindex' } }),
    evidence(prepared, { authenticated: { ...evidence(prepared).authenticated, bodySha256: 'f'.repeat(64) } }),
    evidence(prepared, { authenticated: { ...evidence(prepared).authenticated, requestUrls: [DIRECT_FILE_URL, 'https://third-party.test/pixel'] } }),
    evidence(prepared, { unauthenticated: { ...evidence(prepared).unauthenticated, status: 200 } }),
  ];
  for (const candidate of invalid) assert.throws(() => validateVerificationEvidence(candidate, prepared, now), /verification evidence/);
});

test('successful publish and exact rollback preserve the shell and unrelated children', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const shellBefore = await readFile(value.shell); const unrelatedBefore = await readFile(value.unrelated);
  const published = await publish(value, 'successful-transaction');
  assert.equal(published.journal.phase, 'published');
  assert.equal(published.journal.url, DIRECT_FILE_URL);
  assert.equal(published.journal.publicationVerification.status, 'verified');
  assert.equal((await readFile(path.join(value.galleryRoot, constants.directFilename))).equals(preparedBytes(value.prepared)), true);
  assert.deepEqual(await readFile(value.shell), shellBefore);
  assert.deepEqual(await readFile(value.unrelated), unrelatedBefore);

  await writeFile(path.join(value.galleryRoot, 'concurrent.html'), 'unrelated concurrent child\n', { mode: 0o644 });
  await chmod(path.join(value.galleryRoot, 'concurrent.html'), 0o644);
  const rolled = await rollbackDirectFile({ transactionId: published.transactionId, security: value.security, fs: value.fs, executor: value.executor, now });
  assert.equal(rolled.journal.phase, 'rolled-back');
  assert.equal(rolled.journal.formerUrlVerification.status, 'pending');
  await assert.rejects(() => value.fs.lstat(fixedTarget(constants.galleryRoot)), { code: 'ENOENT' });
  assert.deepEqual(await readFile(value.shell), shellBefore);
  assert.deepEqual(await readFile(value.unrelated), unrelatedBefore);
});

test('missing or failed publication evidence rolls back the exact promoted file without relying on a verifier callback', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  await assert.rejects(
    () => publish(value, 'missing-evidence', { verificationEvidence: undefined }),
    /verification evidence/,
  );
  await assert.rejects(() => value.fs.lstat(fixedTarget(constants.galleryRoot)), { code: 'ENOENT' });
  const journal = JSON.parse(await readFile(path.join(value.stateRoot, 'transactions', 'missing-evidence', 'transaction.json'), 'utf8'));
  assert.equal(journal.phase, 'rolled-back');
  assert.equal(journal.formerUrlVerification.status, 'pending');

  await assert.rejects(
    () => publish(value, 'invalid-evidence', { verificationEvidence: evidence(value.prepared, { authenticated: { ...evidence(value.prepared).authenticated, xRobotsTag: 'noindex' } }) }),
    /verification evidence/,
  );
  await assert.rejects(() => value.fs.lstat(fixedTarget(constants.galleryRoot)), { code: 'ENOENT' });
});

test('RENAME_NOREPLACE collision with identical live and staged content fails closed and preserves both files', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const transactionId = 'exact-content-collision';
  const staged = `${constants.stateRoot}/staging/${transactionId}/${constants.directFilename}`;
  const target = fixedTarget(constants.galleryRoot);
  const collisionFs = {
    ...value.fs,
    async renameNoReplace(source, destination) {
      if (source === staged && destination === target) {
        await writeFile(path.join(value.galleryRoot, constants.directFilename), preparedBytes(value.prepared), { mode: 0o644 });
        await chmod(path.join(value.galleryRoot, constants.directFilename), 0o644);
      }
      return value.fs.renameNoReplace(source, destination);
    },
  };
  await assert.rejects(
    () => publishDirectFile({ prepared: value.prepared, transactionId, security: value.security, fs: collisionFs, executor: createLocalExecutor(collisionFs), verificationEvidence: evidence(value.prepared), now }),
    /collision preserves live and staged files/,
  );
  const livePath = path.join(value.galleryRoot, constants.directFilename);
  const stagedPath = path.join(value.stateRoot, 'staging', transactionId, constants.directFilename);
  assert.deepEqual(await readFile(livePath), preparedBytes(value.prepared));
  assert.deepEqual(await readFile(stagedPath), preparedBytes(value.prepared));
});

test('promoting recovery accepts only the journaled staged inode after the staged name disappears', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  let failedPromotionFsync = false;
  const promotionFs = {
    ...value.fs,
    async fsyncDirectory(target) {
      if (target === constants.galleryRoot && !failedPromotionFsync) {
        failedPromotionFsync = true;
        throw new Error('simulated crash after no-replace rename');
      }
      return value.fs.fsyncDirectory(target);
    },
  };
  await assert.rejects(
    () => publishDirectFile({ prepared: value.prepared, transactionId: 'promoting-recovery', security: value.security, fs: promotionFs, executor: createLocalExecutor(promotionFs), verificationEvidence: evidence(value.prepared), now }),
    /simulated crash after no-replace rename/,
  );
  await assert.rejects(() => value.fs.lstat(fixedTarget(constants.galleryRoot)), { code: 'ENOENT' });
  await assert.rejects(() => value.fs.lstat(`${constants.stateRoot}/staging/promoting-recovery/${constants.directFilename}`), { code: 'ENOENT' });
  const journal = JSON.parse(await readFile(path.join(value.stateRoot, 'transactions', 'promoting-recovery', 'transaction.json'), 'utf8'));
  assert.equal(journal.phase, 'rolled-back');
});

test('nested symlink and cross-device transaction paths reject rollback before any mutation', async (t) => {
  const symlinked = await fixture();
  t.after(() => rm(symlinked.root, { recursive: true, force: true }));
  const outsideTransactions = path.join(symlinked.root, 'outside-transactions');
  await mkdir(outsideTransactions, { mode: 0o700 }); await chmod(outsideTransactions, 0o700);
  await symlink(outsideTransactions, path.join(symlinked.stateRoot, 'transactions'));
  const publishSpy = mutationSpy(symlinked.fs);
  await assert.rejects(
    () => publishDirectFile({ prepared: symlinked.prepared, transactionId: 'symlinked-transaction-parent', security: symlinked.security, fs: publishSpy.fs, executor: createLocalExecutor(publishSpy.fs), verificationEvidence: evidence(symlinked.prepared), now }),
    /symbolic[ -]link/,
  );
  assert.equal(publishSpy.calls.length, 0);

  const quarantined = await fixture();
  t.after(() => rm(quarantined.root, { recursive: true, force: true }));
  const published = await publish(quarantined, 'symlinked-quarantine-parent');
  const outsideQuarantine = path.join(quarantined.root, 'outside-quarantine');
  await mkdir(outsideQuarantine, { mode: 0o700 }); await chmod(outsideQuarantine, 0o700);
  await symlink(outsideQuarantine, path.join(quarantined.stateRoot, 'transactions', published.transactionId, 'quarantine'));
  const rollbackSpy = mutationSpy(quarantined.fs);
  await assert.rejects(
    () => rollbackDirectFile({ transactionId: published.transactionId, security: quarantined.security, fs: rollbackSpy.fs, executor: createLocalExecutor(rollbackSpy.fs), now }),
    /symbolic[ -]link/,
  );
  assert.equal(rollbackSpy.calls.length, 0);

  const crossDevice = await fixture();
  t.after(() => rm(crossDevice.root, { recursive: true, force: true }));
  const crossPublished = await publish(crossDevice, 'cross-device-quarantine-parent');
  const quarantineDirectory = path.join(crossDevice.stateRoot, 'transactions', crossPublished.transactionId, 'quarantine');
  await mkdir(quarantineDirectory, { mode: 0o700 }); await chmod(quarantineDirectory, 0o700);
  const crossSpy = mutationSpy(crossDevice.fs);
  const baseLstat = crossSpy.fs.lstat;
  crossSpy.fs.lstat = async (target) => {
    const stat = await baseLstat(target);
    if (target === `${constants.stateRoot}/transactions/${crossPublished.transactionId}/quarantine`) {
      const replacement = Object.create(Object.getPrototypeOf(stat));
      Object.assign(replacement, stat, { dev: stat.dev + 1 });
      return replacement;
    }
    return stat;
  };
  await assert.rejects(
    () => rollbackDirectFile({ transactionId: crossPublished.transactionId, security: crossDevice.security, fs: crossSpy.fs, executor: createLocalExecutor(crossSpy.fs), now }),
    /gallery filesystem device/,
  );
  assert.equal(crossSpy.calls.length, 0);
});

test('rollback verify-only validates journal and identities but performs zero mutations and reports exact operations', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const published = await publish(value, 'verify-only-transaction');
  const spy = mutationSpy(value.fs);
  const verified = await rollbackDirectFile({ transactionId: published.transactionId, security: value.security, verifyOnly: true, fs: spy.fs, executor: createLocalExecutor(spy.fs), now });
  assert.equal(verified.verifyOnly, true);
  assert.deepEqual(verified.plannedOperations, [
    { operation: 'rename-no-replace', from: fixedTarget(constants.galleryRoot), to: `${constants.stateRoot}/transactions/${published.transactionId}/quarantine/${constants.directFilename}` },
    { operation: 'remove', target: `${constants.stateRoot}/transactions/${published.transactionId}/quarantine/${constants.directFilename}` },
    { operation: 'prove-absence', target: fixedTarget(constants.galleryRoot) },
  ]);
  assert.deepEqual(spy.calls, []);

  const quarantineDirectory = path.join(value.stateRoot, 'transactions', published.transactionId, 'quarantine');
  await mkdir(quarantineDirectory, { mode: 0o700 }); await chmod(quarantineDirectory, 0o700);
  await writeFile(path.join(quarantineDirectory, constants.directFilename), preparedBytes(value.prepared), { mode: 0o644 });
  await chmod(path.join(quarantineDirectory, constants.directFilename), 0o644);
  await assert.rejects(
    () => rollbackDirectFile({ transactionId: published.transactionId, security: value.security, verifyOnly: true, fs: spy.fs, executor: createLocalExecutor(spy.fs), now }),
    /absent quarantine target/,
  );
  assert.deepEqual(spy.calls, []);
});

test('rollback retains a same-content quarantine replacement whose inode is not journal-authorized', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const transactionId = 'quarantine-identity-drift';
  const published = await publish(value, transactionId);
  await assert.rejects(
    () => rollbackDirectFile({ transactionId, security: value.security, fs: value.fs, executor: value.executor, now, phaseHook: async (phase) => { if (phase === 'artifact-quarantined') throw new Error('simulated quarantine crash'); } }),
    /simulated quarantine crash/,
  );
  const quarantine = path.join(value.stateRoot, 'transactions', transactionId, 'quarantine', constants.directFilename);
  const replacement = `${quarantine}.replacement`;
  await writeFile(replacement, preparedBytes(value.prepared), { mode: 0o644 }); await chmod(replacement, 0o644);
  await rename(replacement, quarantine);
  await assert.rejects(
    () => rollbackDirectFile({ transactionId, security: value.security, fs: value.fs, executor: value.executor, now }),
    /quarantined direct-file identity drift/,
  );
  assert.deepEqual(await readFile(quarantine), preparedBytes(value.prepared));
});

test('promotion crash recovery rolls back only the journal-authorized fixed file', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  await assert.rejects(
    () => publish(value, 'promoted-crash', { phaseHook: async (phase) => { if (phase === 'promoted') throw new Error('simulated crash'); } }),
    /simulated crash/,
  );
  await assert.rejects(() => value.fs.lstat(fixedTarget(constants.galleryRoot)), { code: 'ENOENT' });
  assert.equal((await readFile(value.shell)).toString(), 'shell bytes stay untouched\n');
});

test('CLI seals the internal executor and source code cannot address the shell or generic publisher', async () => {
  await assert.rejects(
    () => runCli(['publish-file', '--executor-module', '/var/tmp/unreviewed.mjs']),
    /outside the direct-file allowlist/,
  );
  const [source, primitives, executor] = await Promise.all([
    readFile(new URL('../../scripts/explainers/direct-file.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../scripts/explainers/direct-file-primitives.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../scripts/explainers/direct-file-ssh-executor.mjs', import.meta.url), 'utf8'),
  ]);
  for (const value of [source, primitives, executor]) assert.doesNotMatch(value, /gallery-index|publisher\.mjs|index\.html|readdir|withLock|locks/);
  assert.doesNotMatch(source, /executor-module/);
  assert.doesNotMatch(executor, /recursive|glob|wildcard/);
});
