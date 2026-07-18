import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  assertPreparedDirectFile,
  deserializeDirectFile,
  DIRECT_FILE_CSP,
  DIRECT_FILE_URL,
  DirectFileValidationError,
  finalizeDirectFile,
  prepareDirectFile,
  publishDirectFile,
  rollbackDirectFile,
  runCli,
  serializableDirectFile,
  validateFinalizationEvidence,
} from '../../scripts/explainers/direct-file.mjs';
import { DIRECT_FILE_OAUTH_GATE_URL } from '../../scripts/explainers/direct-file-verifier.mjs';
import { constants, createLocalExecutor, createNodeFilesystem, fixedTarget } from '../../scripts/explainers/direct-file-primitives.mjs';

const NOW = '2026-07-18T12:00:00.000Z';
const now = () => new Date(NOW);
const privateReviewDirectory = path.join('/code', '.private', 'explainers', constants.directSlug);
const reviewedArtifactPath = path.join(privateReviewDirectory, 'index.html');
const reviewedMetadataPath = path.join(privateReviewDirectory, 'gallery-entry.json');

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function artifact({ head = '', body = '<main><h1>Neutral direct artifact</h1><p>Neutral local proof.</p></main>' } = {}) {
  return Buffer.from(`<!doctype html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta content=" initial-scale = 1, width = device-width " name="viewport">
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
function finalizationEvidence(journal, overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'direct-file-finalization',
    transactionId: journal.transactionId,
    verificationNonce: journal.verificationNonce,
    promotedAt: journal.promotedAt,
    url: DIRECT_FILE_URL,
    artifactSha256: journal.artifactSha256,
    artifactSize: journal.artifactSize,
    capturedAt: NOW,
    authenticated: {
      status: 200,
      bodySha256: journal.artifactSha256,
      bodySize: journal.artifactSize,
      xRobotsTag: 'noindex, nofollow, noarchive',
      requestUrls: [DIRECT_FILE_URL],
    },
    unauthenticated: {
      status: 302,
      bodySha256: '0'.repeat(64),
      artifactLeaked: false,
      requestUrls: [DIRECT_FILE_URL],
      location: DIRECT_FILE_OAUTH_GATE_URL,
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
    now,
    ...options,
  });
}

async function createSafeEmptyQuarantineDirectory(value, transactionId) {
  const directory = `${constants.stateRoot}/transactions/${transactionId}/quarantine`;
  await value.fs.mkdir(directory, { recursive: false, mode: value.security.state.directoryMode });
  await value.fs.chown(directory, value.security.state.uid, value.security.state.gid);
  await value.fs.chmod(directory, value.security.state.directoryMode);
  await value.fs.fsyncDirectory(`${constants.stateRoot}/transactions/${transactionId}`);
  return directory;
}

async function assertFinalizationRolledBack(value, transactionId) {
  const journal = JSON.parse(await readFile(path.join(value.stateRoot, 'transactions', transactionId, 'transaction.json'), 'utf8'));
  assert.equal(journal.phase, 'rolled-back');
  for (const target of [
    fixedTarget(constants.galleryRoot),
    `${constants.stateRoot}/staging/${transactionId}/${constants.directFilename}`,
    `${constants.stateRoot}/transactions/${transactionId}/quarantine/${constants.directFilename}`,
  ]) await assert.rejects(() => value.fs.lstat(target), { code: 'ENOENT' });
}

test('receipt accepts the fixed full URL, safe charset/viewport metadata, data images, and bare details open while rejecting malformed, executable, navigation, and unsupported attributes', () => {
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
    artifact({ body: '<main open><p>Neutral local proof.</p></main>' }),
    artifact({ body: '<details hidden><summary>Neutral detail</summary><p>Neutral local proof.</p></details>' }),
    artifact({ body: '<details onclick><summary>Neutral detail</summary><p>Neutral local proof.</p></details>' }),
    artifact({ body: '<details open=enabled><summary>Neutral detail</summary><p>Neutral local proof.</p></details>' }),
    artifact({ body: '<main class=neutral><p>Neutral local proof.</p></main>' }),
    artifact({ head: '<meta name="description" content="not allowed">' }),
    artifact({ head: '<meta charset="iso-8859-1">' }),
    artifact({ head: '<meta name="viewport" content="width=device-width, initial-scale=2">' }),
    artifact({ head: '<meta charset="utf-8">' }),
    Buffer.from(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${DIRECT_FILE_CSP}"></head><body><main>broken</main></html>`),
  ];
  for (const invalid of invalidArtifacts) {
    assert.throws(() => prepareDirectFile({ artifactBytes: invalid, metadata: metadata(invalid) }), /direct artifact/);
  }
  const secret = artifact({ body: '<main>api_key=not-for-publication</main>' });
  assert.throws(() => prepareDirectFile({ artifactBytes: secret, metadata: metadata(secret) }), /secret-shaped/);
  assert.throws(() => assertPreparedDirectFile({ ...prepared, filename: 'index.html' }), /fixed identity/);
});

test('neutral structural fixture with the exact safe details open form prepares successfully', () => {
  const bytes = artifact({ body: '<main><h1>Neutral direct artifact</h1><details open><summary>Architecture summary</summary><p>Neutral local proof.</p></details><details><summary>Further detail</summary><p>Static disclosure.</p></details></main>' });
  const prepared = prepareDirectFile({ artifactBytes: bytes, metadata: metadata(bytes), artifactBodyMarker: 'Neutral local proof.' });
  assert.equal(prepared.artifactSha256, sha256(bytes));
  assert.equal(prepared.artifactSize, bytes.length);
});

test('neutral color-scheme dark metadata prepares while other metadata values, names, and attributes fail', () => {
  const valid = artifact({ head: '<meta content=" DARK " name="color-scheme">' });
  const prepared = prepareDirectFile({ artifactBytes: valid, metadata: metadata(valid), artifactBodyMarker: 'Neutral local proof.' });
  assert.equal(prepared.artifactSha256, sha256(valid));
  const invalid = [
    artifact({ head: '<meta name="color-scheme" content="light">' }),
    artifact({ head: '<meta name="color-scheme" content="dark light">' }),
    artifact({ head: '<meta name="color-scheme" content="dark https://attacker.test">' }),
    artifact({ head: '<meta name="theme-color" content="dark">' }),
    artifact({ head: '<meta name="referrer" content="dark">' }),
    artifact({ head: '<meta property="og:image" content="https://attacker.test/preview.png">' }),
    artifact({ head: '<meta name="color-scheme" content="dark" data-extra="no">' }),
    artifact({ head: '<meta name="color-scheme" content="dark"><meta name="color-scheme" content="dark">' }),
  ];
  for (const bytes of invalid) assert.throws(() => prepareDirectFile({ artifactBytes: bytes, metadata: metadata(bytes) }), /unsupported meta declaration|complete static HTML document/);
});

test('neutral same-document fragment anchors with the approved attribute forms and unique ids prepare', () => {
  const sections = ['overview', 'owners', 'updates', 'vault', 'registry', 'evidence', 'routing', 'summary'];
  const anchors = [
    ...sections.slice(0, 6).map((id) => `<a href="#${id}">Neutral ${id}</a>`),
    '<a class="section-link" href="#routing">Neutral routing</a>',
    '<a class="section-link" href="#summary" aria-label="Skip to neutral summary">Neutral summary</a>',
  ].join('');
  const bodies = sections.map((id) => `<section id="${id}"><p>Neutral ${id} section.</p></section>`).join('');
  const valid = artifact({ body: `<nav>${anchors}</nav><main>${bodies}<p>Neutral local proof.</p></main>` });
  const prepared = prepareDirectFile({ artifactBytes: valid, metadata: metadata(valid), artifactBodyMarker: 'Neutral local proof.' });
  assert.equal(prepared.artifactSha256, sha256(valid));

  const withAnchor = (anchor, ids = '<section id="target"><p>Neutral target.</p></section>') => artifact({ body: `<main>${anchor}${ids}<p>Neutral local proof.</p></main>` });
  const invalid = [
    withAnchor('<a href="#">Empty fragment</a>'),
    withAnchor('<a href="#target%20encoded">Encoded fragment</a>'),
    withAnchor('<a href="#target/path">Slash fragment</a>'),
    withAnchor('<a href="#target:fragment">Colon fragment</a>'),
    withAnchor('<a href="#target fragment">Whitespace fragment</a>'),
    withAnchor('<a href="/target">Relative target</a>'),
    withAnchor('<a href="https://attacker.test/#target">External target</a>'),
    withAnchor('<a href="mailto:attacker@example.test">Protocol target</a>'),
    withAnchor('<a href="#missing">Missing target</a>'),
    withAnchor('<a href="#target" target="_blank">Target attribute</a>'),
    withAnchor('<a href="#target" download>Download attribute</a>'),
    withAnchor('<a href="#target" rel="noopener">Rel attribute</a>'),
    withAnchor('<a href="#target" ping="https://attacker.test">Ping attribute</a>'),
    withAnchor('<a href="#target" referrerpolicy="no-referrer">Referrer policy attribute</a>'),
    withAnchor('<a href="#target" onclick="alert(1)">Event attribute</a>'),
    withAnchor('<a href="#target" class="https://attacker.test">URL-like class</a>'),
    withAnchor('<a href="#target" aria-label="https://attacker.test">URL-like label</a>'),
    withAnchor('<a href="#target" aria-label="neutral\u0001label">Control label</a>'),
    withAnchor('<a href="#target">Duplicate target</a>', '<section id="target"></section><section id="target"></section>'),
    withAnchor('<a href="#target">Unsafe id</a>', '<section id="target:unsafe"></section>'),
    artifact({ body: '<main><section id="duplicate"></section><section id="duplicate"></section><p>Neutral local proof.</p></main>' }),
    artifact({ body: '<main><area href="#target"><p>Neutral local proof.</p></main>' }),
  ];
  for (const bytes of invalid) assert.throws(() => prepareDirectFile({ artifactBytes: bytes, metadata: metadata(bytes) }), /direct artifact/);
});

test('neutral self-closing static SVG geometry permits only the reviewed circle and path forms and rejects SVG mutation markup', () => {
  const valid = artifact({ body: '<main><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="2" fill="#ffffff"/><path d="M 0 0 L 1 1" fill="none"/><path d="M 1 1 L 2 2" fill="none" stroke="#000000" stroke-width="1" stroke-linecap="round"/><path d="M 2 2 L 3 3" fill="none" stroke="#000000" stroke-width="1" vector-effect="non-scaling-stroke"/></svg><p>Neutral local proof.</p></main>' });
  const prepared = prepareDirectFile({ artifactBytes: valid, metadata: metadata(valid), artifactBodyMarker: 'Neutral local proof.' });
  assert.equal(prepared.artifactSha256, sha256(valid));
  const invalid = [
    artifact({ body: '<main><div/><p>Neutral local proof.</p></main>' }),
    artifact({ body: '<main><circle cx="5" cy="5" r="2" fill="#ffffff"/><p>Neutral local proof.</p></main>' }),
    artifact({ body: '<main><circle cx="5" cy="5" r="2" fill="url(https://attacker.test/paint)"/><p>Neutral local proof.</p></main>' }),
    artifact({ body: '<main><path d="M 0 0 url(https://attacker.test/path)" fill="none"/><p>Neutral local proof.</p></main>' }),
    artifact({ body: '<main><path d="M 0 0 L 1 1" fill="none" href="#target"/><p>Neutral local proof.</p></main>' }),
    artifact({ body: '<main><svg><path d="M 0 0 L 1 1" fill="none"></path><p>Neutral local proof.</p></svg></main>' }),
    artifact({ body: '<main><path d="M 0 0 L 1 1" fill="none" stroke="#000000" stroke-width="1" vector-effect="scaling-stroke"/><p>Neutral local proof.</p></main>' }),
    artifact({ body: '<main><section id="target"><p>Neutral target.</p></section><svg><a href="#target"><set attributeName="href" to="https://attacker.test/navigation" begin="0s"></set></a></svg><p>Neutral local proof.</p></main>' }),
    ...['set', 'animate', 'animateMotion', 'animateTransform', 'discard'].map((element) => artifact({ body: `<main><svg><${element}></${element}></svg><p>Neutral local proof.</p></main>` })),
    artifact({ body: '<main><svg><foreignObject><p>Neutral foreign content.</p></foreignObject></svg><p>Neutral local proof.</p></main>' }),
  ];
  for (const bytes of invalid) assert.throws(() => prepareDirectFile({ artifactBytes: bytes, metadata: metadata(bytes) }), /direct artifact/);
});

test('reviewed off-repository artifact prepares when local review inputs are available', {
  skip: existsSync(reviewedArtifactPath) && existsSync(reviewedMetadataPath) ? false : 'off-repository reviewed artifact inputs are unavailable on this machine',
}, async () => {
  const [artifactBytes, metadataBytes] = await Promise.all([readFile(reviewedArtifactPath), readFile(reviewedMetadataPath)]);
  const prepared = prepareDirectFile({ artifactBytes, metadata: JSON.parse(metadataBytes.toString('utf8')) });
  assert.equal(prepared.artifactSize, artifactBytes.length);
  assert.equal(prepared.artifactSha256, sha256(artifactBytes));
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

test('finalization evidence is current, nonce-bound to the promoted transaction, and proves the exact artifact and expected OAuth gate', () => {
  const bytes = artifact();
  const prepared = prepareDirectFile({ artifactBytes: bytes, metadata: metadata(bytes) });
  const journal = {
    transactionId: 'evidence-transaction',
    verificationNonce: 'a'.repeat(64),
    promotedAt: NOW,
    artifactSha256: prepared.artifactSha256,
    artifactSize: prepared.artifactSize,
  };
  assert.deepEqual(validateFinalizationEvidence(finalizationEvidence(journal), journal, now), finalizationEvidence(journal));
  const invalid = [
    undefined,
    finalizationEvidence(journal, { url: 'https://heydex.ai/explainers/other.html' }),
    finalizationEvidence(journal, { verificationNonce: 'b'.repeat(64) }),
    finalizationEvidence(journal, { capturedAt: '2026-07-18T11:00:00.000Z' }),
    finalizationEvidence(journal, { authenticated: { ...finalizationEvidence(journal).authenticated, xRobotsTag: 'noindex' } }),
    finalizationEvidence(journal, { authenticated: { ...finalizationEvidence(journal).authenticated, bodySha256: 'f'.repeat(64) } }),
    finalizationEvidence(journal, { authenticated: { ...finalizationEvidence(journal).authenticated, requestUrls: [DIRECT_FILE_URL, 'https://third-party.test/pixel'] } }),
    finalizationEvidence(journal, { unauthenticated: { ...finalizationEvidence(journal).unauthenticated, status: 200 } }),
    finalizationEvidence(journal, { unauthenticated: { ...finalizationEvidence(journal).unauthenticated, location: 'https://heydex.ai/oauth2/sign_in' } }),
  ];
  for (const candidate of invalid) assert.throws(() => validateFinalizationEvidence(candidate, journal, now), /finalization evidence|verification evidence/);
  const prePromotionJournal = { ...journal, promotedAt: '2026-07-18T11:50:00.000Z' };
  assert.throws(() => validateFinalizationEvidence(finalizationEvidence(prePromotionJournal, { capturedAt: '2026-07-18T11:49:00.000Z' }), prePromotionJournal, now), /post-promotion/);
});

test('successful publish and exact rollback preserve the shell and unrelated children', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const shellBefore = await readFile(value.shell); const unrelatedBefore = await readFile(value.unrelated);
  const promoted = await publish(value, 'successful-transaction');
  assert.equal(promoted.journal.phase, 'promoted-awaiting-verification');
  assert.equal(promoted.journal.url, DIRECT_FILE_URL);
  assert.match(promoted.journal.verificationNonce, /^[a-f0-9]{64}$/);
  assert.equal(promoted.journal.publicationVerification.status, 'pending');
  const published = await finalizeDirectFile({
    transactionId: promoted.transactionId,
    security: value.security,
    fs: value.fs,
    executor: value.executor,
    now,
    verifier: { verify: async (input) => finalizationEvidence(input) },
  });
  assert.equal(published.journal.phase, 'published');
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

test('fabricated finalization evidence automatically rolls back the exact promoted artifact', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const promoted = await publish(value, 'fabricated-finalization');
  await assert.rejects(
    () => finalizeDirectFile({ transactionId: promoted.transactionId, security: value.security, fs: value.fs, executor: value.executor, now, verifier: { verify: async (input) => finalizationEvidence(input, { verificationNonce: 'f'.repeat(64) }) } }),
    (error) => {
      assert.match(error.message, /not bound/);
      assert.doesNotMatch(error.message, /finalization recovery failed/);
      return true;
    },
  );
  await assertFinalizationRolledBack(value, promoted.transactionId);
});

test('fixed verifier failure automatically rolls back and preserves the original error', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const promoted = await publish(value, 'verifier-finalization-failure');
  const verifierFailure = new Error('simulated fixed verifier network failure');
  await assert.rejects(
    () => finalizeDirectFile({ transactionId: promoted.transactionId, security: value.security, fs: value.fs, executor: value.executor, now, verifier: { verify: async () => { throw verifierFailure; } } }),
    (error) => {
      assert.equal(error, verifierFailure);
      return true;
    },
  );
  await assertFinalizationRolledBack(value, promoted.transactionId);
});

test('failed finalization recovery reports identity drift distinctly and retains the replacement', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const promoted = await publish(value, 'post-verifier-identity-check');
  await assert.rejects(
    () => finalizeDirectFile({
      transactionId: promoted.transactionId,
      security: value.security,
      fs: value.fs,
      executor: value.executor,
      now,
      verifier: {
        verify: async (input) => {
          const replacement = path.join(value.galleryRoot, 'replacement.html');
          await writeFile(replacement, preparedBytes(value.prepared), { mode: 0o644 });
          await chmod(replacement, 0o644);
          await rename(replacement, path.join(value.galleryRoot, constants.directFilename));
          return finalizationEvidence(input);
        },
      },
    }),
    (error) => {
      assert.ok(error instanceof DirectFileValidationError);
      assert.match(error.message, /direct-file finalization recovery failed: promoted direct-file identity drift refuses deletion/);
      assert.ok(error.cause instanceof DirectFileValidationError);
      assert.match(error.cause.message, /promoted direct-file identity drift refuses finalization/);
      return true;
    },
  );
  const journal = JSON.parse(await readFile(path.join(value.stateRoot, 'transactions', promoted.transactionId, 'transaction.json'), 'utf8'));
  assert.equal(journal.phase, 'promoted-awaiting-verification');
  assert.equal(journal.publicationVerification.status, 'pending');
  assert.equal((await value.fs.lstat(fixedTarget(constants.galleryRoot))).isFile(), true);
  await assert.rejects(() => value.fs.lstat(`${constants.stateRoot}/transactions/${promoted.transactionId}/quarantine/${constants.directFilename}`), { code: 'ENOENT' });
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
    () => publishDirectFile({ prepared: value.prepared, transactionId, security: value.security, fs: collisionFs, executor: createLocalExecutor(collisionFs), now }),
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
    () => publishDirectFile({ prepared: value.prepared, transactionId: 'promoting-recovery', security: value.security, fs: promotionFs, executor: createLocalExecutor(promotionFs), now }),
    /simulated crash after no-replace rename/,
  );
  await assert.rejects(() => value.fs.lstat(fixedTarget(constants.galleryRoot)), { code: 'ENOENT' });
  await assert.rejects(() => value.fs.lstat(`${constants.stateRoot}/staging/promoting-recovery/${constants.directFilename}`), { code: 'ENOENT' });
  const journal = JSON.parse(await readFile(path.join(value.stateRoot, 'transactions', 'promoting-recovery', 'transaction.json'), 'utf8'));
  assert.equal(journal.phase, 'rolled-back');
});

test('pre-promotion recovery removes staged content without a quarantine and preserves the original failure', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const transactionId = 'uploaded-recovery';
  const shellBefore = await readFile(value.shell); const unrelatedBefore = await readFile(value.unrelated);
  await assert.rejects(
    () => publish(value, transactionId, { phaseHook: async (phase) => { if (phase === 'uploaded') throw new Error('simulated post-upload failure'); } }),
    (error) => {
      assert.equal(error.message, 'simulated post-upload failure');
      assert.doesNotMatch(error.message, /publication recovery failed/);
      return true;
    },
  );
  await assert.rejects(() => value.fs.lstat(fixedTarget(constants.galleryRoot)), { code: 'ENOENT' });
  await assert.rejects(() => value.fs.lstat(`${constants.stateRoot}/staging/${transactionId}/${constants.directFilename}`), { code: 'ENOENT' });
  await assert.rejects(() => value.fs.lstat(`${constants.stateRoot}/transactions/${transactionId}/quarantine`), { code: 'ENOENT' });
  const journal = JSON.parse(await readFile(path.join(value.stateRoot, 'transactions', transactionId, 'transaction.json'), 'utf8'));
  assert.equal(journal.phase, 'rolled-back');
  assert.deepEqual(await readFile(value.shell), shellBefore);
  assert.deepEqual(await readFile(value.unrelated), unrelatedBefore);
});

test('pre-staging recovery completes without a staging file or quarantine', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const transactionId = 'uploading-recovery';
  const shellBefore = await readFile(value.shell); const unrelatedBefore = await readFile(value.unrelated);
  await assert.rejects(
    () => publish(value, transactionId, { phaseHook: async (phase) => { if (phase === 'uploading') throw new Error('simulated pre-staging failure'); } }),
    (error) => {
      assert.equal(error.message, 'simulated pre-staging failure');
      assert.doesNotMatch(error.message, /publication recovery failed/);
      return true;
    },
  );
  await assert.rejects(() => value.fs.lstat(fixedTarget(constants.galleryRoot)), { code: 'ENOENT' });
  await assert.rejects(() => value.fs.lstat(`${constants.stateRoot}/staging/${transactionId}/${constants.directFilename}`), { code: 'ENOENT' });
  await assert.rejects(() => value.fs.lstat(`${constants.stateRoot}/transactions/${transactionId}/quarantine`), { code: 'ENOENT' });
  const journal = JSON.parse(await readFile(path.join(value.stateRoot, 'transactions', transactionId, 'transaction.json'), 'utf8'));
  assert.equal(journal.phase, 'rolled-back');
  assert.deepEqual(await readFile(value.shell), shellBefore);
  assert.deepEqual(await readFile(value.unrelated), unrelatedBefore);
});

test('nested symlink and cross-device transaction paths reject rollback before any mutation', async (t) => {
  const symlinked = await fixture();
  t.after(() => rm(symlinked.root, { recursive: true, force: true }));
  const outsideTransactions = path.join(symlinked.root, 'outside-transactions');
  await mkdir(outsideTransactions, { mode: 0o700 }); await chmod(outsideTransactions, 0o700);
  await symlink(outsideTransactions, path.join(symlinked.stateRoot, 'transactions'));
  const publishSpy = mutationSpy(symlinked.fs);
  await assert.rejects(
    () => publishDirectFile({ prepared: symlinked.prepared, transactionId: 'symlinked-transaction-parent', security: symlinked.security, fs: publishSpy.fs, executor: createLocalExecutor(publishSpy.fs), now }),
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

test('rollback retry reuses a safe empty quarantine directory after a pre-rename phase crash', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const transactionId = 'quarantine-pre-rename-retry';
  const published = await publish(value, transactionId);
  const shellBefore = await readFile(value.shell); const unrelatedBefore = await readFile(value.unrelated);
  const quarantineDirectory = `${constants.stateRoot}/transactions/${transactionId}/quarantine`;
  const quarantineTarget = `${quarantineDirectory}/${constants.directFilename}`;
  await assert.rejects(
    () => rollbackDirectFile({ transactionId, security: value.security, fs: value.fs, executor: value.executor, now, phaseHook: async (phase) => { if (phase === 'artifact-quarantining') throw new Error('simulated pre-rename phase crash'); } }),
    (error) => {
      assert.equal(error.message, 'simulated pre-rename phase crash');
      assert.doesNotMatch(error.message, /publication recovery failed/);
      return true;
    },
  );
  assert.equal((await value.fs.lstat(fixedTarget(constants.galleryRoot))).isFile(), true);
  assert.equal((await value.fs.lstat(quarantineDirectory)).isDirectory(), true);
  await assert.rejects(() => value.fs.lstat(quarantineTarget), { code: 'ENOENT' });
  const interrupted = JSON.parse(await readFile(path.join(value.stateRoot, 'transactions', transactionId, 'transaction.json'), 'utf8'));
  assert.equal(interrupted.phase, 'artifact-quarantining');

  const rolled = await rollbackDirectFile({ transactionId: published.transactionId, security: value.security, fs: value.fs, executor: value.executor, now });
  assert.equal(rolled.journal.phase, 'rolled-back');
  await assert.rejects(() => value.fs.lstat(fixedTarget(constants.galleryRoot)), { code: 'ENOENT' });
  await assert.rejects(() => value.fs.lstat(quarantineTarget), { code: 'ENOENT' });
  assert.deepEqual(await readFile(value.shell), shellBefore);
  assert.deepEqual(await readFile(value.unrelated), unrelatedBefore);
});

test('rollback reuses a safe empty quarantine directory created before its quarantine phase', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const transactionId = 'quarantine-pre-phase-retry';
  const published = await publish(value, transactionId);
  const shellBefore = await readFile(value.shell); const unrelatedBefore = await readFile(value.unrelated);
  const quarantineDirectory = await createSafeEmptyQuarantineDirectory(value, transactionId);
  const quarantineTarget = `${quarantineDirectory}/${constants.directFilename}`;
  assert.equal(published.journal.phase, 'promoted-awaiting-verification');
  assert.equal((await value.fs.lstat(quarantineDirectory)).isDirectory(), true);
  await assert.rejects(() => value.fs.lstat(quarantineTarget), { code: 'ENOENT' });

  const rolled = await rollbackDirectFile({ transactionId: published.transactionId, security: value.security, fs: value.fs, executor: value.executor, now });
  assert.equal(rolled.journal.phase, 'rolled-back');
  await assert.rejects(() => value.fs.lstat(fixedTarget(constants.galleryRoot)), { code: 'ENOENT' });
  await assert.rejects(() => value.fs.lstat(quarantineTarget), { code: 'ENOENT' });
  assert.deepEqual(await readFile(value.shell), shellBefore);
  assert.deepEqual(await readFile(value.unrelated), unrelatedBefore);
});

test('promotion crash recovery rolls back only the journal-authorized fixed file', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  await assert.rejects(
    () => publish(value, 'promoted-crash', { phaseHook: async (phase) => { if (phase === 'promoted-awaiting-verification') throw new Error('simulated crash'); } }),
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
  await assert.rejects(
    () => runCli(['finalize-file', '--verification-evidence', '/var/tmp/caller-authored.json']),
    /outside the direct-file allowlist/,
  );
  const [source, primitives, executor] = await Promise.all([
    readFile(new URL('../../scripts/explainers/direct-file.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../scripts/explainers/direct-file-primitives.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../scripts/explainers/direct-file-ssh-executor.mjs', import.meta.url), 'utf8'),
  ]);
  for (const value of [source, primitives, executor]) assert.doesNotMatch(value, /gallery-index|publisher\.mjs|index\.html|readdir|withLock|locks/);
  assert.doesNotMatch(source, /executor-module/);
  assert.doesNotMatch(source, /verification-evidence/);
  assert.match(source, /finalize-file/);
  assert.doesNotMatch(executor, /recursive|glob|wildcard/);
});
