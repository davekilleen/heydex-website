import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { sha256 } from '../../scripts/explainers/gallery-index.mjs';
import {
  createLocalExecutor,
  createNodeFilesystem,
  prepare,
  publish,
  rollback,
  verifyAuthenticatedFallback,
} from '../../scripts/explainers/publisher.mjs';

const ORIGINAL_INDEX = Buffer.from('opaque generic gallery index\n');
const ARTIFACT_INDEX = Buffer.from('<!doctype html><title>Neutral artifact</title>\n');

function fingerprint(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function inventory(bytes) {
  const prior = [{ slug: 'existing-entry', note: 'opaque prior entry' }];
  const matches = bytes.toString('utf8').match(/\nFAKE_ENTRY:([a-z0-9-]+)\n/g) ?? [];
  return [
    ...prior,
    ...matches.map((line) => ({ slug: line.slice('\nFAKE_ENTRY:'.length, -1), note: 'fake addition' })),
  ];
}

function adapter() {
  return {
    version: 'fake-publisher-adapter-v1',
    fingerprint,
    inventory,
    createCandidate({ indexBytes, metadata }) {
      const added = Buffer.from(`\nFAKE_ENTRY:${metadata.slug}\n`);
      const candidateBytes = Buffer.concat([indexBytes, added]);
      return {
        candidateBytes,
        declaredEditRanges: [{
          beforeStart: indexBytes.length,
          beforeEnd: indexBytes.length,
          afterStart: indexBytes.length,
          afterEnd: candidateBytes.length,
        }],
        previousEntries: inventory(indexBytes),
        candidateEntries: inventory(candidateBytes),
      };
    },
  };
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'heydex-explainer-publisher-'));
  const galleryRoot = path.join(root, 'gallery');
  const stateRoot = path.join(root, 'state');
  const artifactDirectory = path.join(root, 'artifact');
  await mkdir(galleryRoot, { recursive: true });
  await mkdir(stateRoot, { recursive: true });
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(path.join(galleryRoot, 'index.html'), ORIGINAL_INDEX);
  await mkdir(path.join(galleryRoot, 'unrelated-artifact'));
  await writeFile(path.join(galleryRoot, 'unrelated-artifact', 'keep.txt'), 'keep this byte-identical');
  await writeFile(path.join(artifactDirectory, 'index.html'), ARTIFACT_INDEX);

  const metadata = {
    schemaVersion: 1,
    slug: 'new-entry',
    title: 'Neutral artifact',
    summary: 'Neutral publication test artifact',
    createdAt: '2026-07-17T00:00:00.000Z',
    artifactSha256: sha256(ARTIFACT_INDEX),
  };
  const prepared = prepare({ indexBytes: ORIGINAL_INDEX, metadata, adapter: adapter() });

  return {
    root,
    galleryRoot,
    stateRoot,
    artifactDirectory,
    metadata,
    prepared,
    adapter: adapter(),
    fs: createNodeFilesystem(),
  };
}

async function publishFixture(fixture, overrides = {}) {
  return publish({
    prepared: fixture.prepared,
    adapter: fixture.adapter,
    artifactDirectory: fixture.artifactDirectory,
    galleryRoot: fixture.galleryRoot,
    stateRoot: fixture.stateRoot,
    transactionId: 'transaction-1',
    fs: fixture.fs,
    executor: createLocalExecutor(fixture.fs),
    postPublishVerifier: async () => ({ status: 200 }),
    authenticatedVerifier: async () => ({ status: 200, body: 'authenticated gallery fallback' }),
    ...overrides,
  });
}

test('publish journals, stages, and atomically promotes only the requested slug', async (t) => {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  const result = await publishFixture(fixture);
  const journal = JSON.parse(await readFile(path.join(result.transactionRoot, 'transaction.json'), 'utf8'));

  assert.equal(journal.phase, 'published');
  assert.equal(journal.slug, 'new-entry');
  assert.equal((await readFile(path.join(fixture.galleryRoot, 'index.html'))).equals(fixture.prepared.candidateBytes), true);
  assert.equal(await exists(path.join(fixture.galleryRoot, 'new-entry', 'index.html')), true);
  assert.equal(await readFile(path.join(fixture.galleryRoot, 'unrelated-artifact', 'keep.txt'), 'utf8'), 'keep this byte-identical');
  assert.equal(await exists(path.join(fixture.stateRoot, 'locks', 'publisher.lock')), false);
});

test('publish refuses a staged candidate checksum mismatch before promotion', async (t) => {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  const baseFs = fixture.fs;
  fixture.fs = {
    ...baseFs,
    async writeFile(target, contents, options) {
      await baseFs.writeFile(target, contents, options);
      if (target.endsWith(`${path.sep}staging${path.sep}transaction-1${path.sep}candidate-index.html`)) {
        await baseFs.writeFile(target, Buffer.from('corrupted staged candidate'));
      }
    },
  };

  await assert.rejects(() => publishFixture(fixture), /staged candidate index checksum mismatch/);
  assert.equal((await readFile(path.join(fixture.galleryRoot, 'index.html'))).equals(ORIGINAL_INDEX), true);
  assert.equal(await exists(path.join(fixture.galleryRoot, 'new-entry')), false);
});

test('publish refuses a pre-existing artifact and concurrent lock without touching the index', async (t) => {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  await mkdir(path.join(fixture.galleryRoot, 'new-entry'));
  await assert.rejects(() => publishFixture(fixture), /remote lstat did not prove/);
  assert.equal((await readFile(path.join(fixture.galleryRoot, 'index.html'))).equals(ORIGINAL_INDEX), true);

  await rm(path.join(fixture.galleryRoot, 'new-entry'), { recursive: true });
  await mkdir(path.join(fixture.stateRoot, 'locks'), { recursive: true });
  await writeFile(path.join(fixture.stateRoot, 'locks', 'publisher.lock'), 'other publisher');
  await assert.rejects(
    () => publishFixture(fixture, { transactionId: 'transaction-2' }),
    /publisher lock is already held/,
  );
  assert.equal((await readFile(path.join(fixture.galleryRoot, 'index.html'))).equals(ORIGINAL_INDEX), true);
});

test('publish requires both lstat and test ! -e absence evidence before staging', async (t) => {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  const executor = {
    async lstat() {
      return { exists: false };
    },
    async testAbsent() {
      return false;
    },
  };

  await assert.rejects(
    () => publishFixture(fixture, { executor }),
    /remote test ! -e did not prove/,
  );
  assert.equal((await readFile(path.join(fixture.galleryRoot, 'index.html'))).equals(ORIGINAL_INDEX), true);
  assert.equal(await exists(path.join(fixture.galleryRoot, 'new-entry')), false);
});

test('publish refuses preflight drift and cleans up an interrupted index promotion', async (t) => {
  const drifted = await setup();
  t.after(() => rm(drifted.root, { recursive: true, force: true }));
  await writeFile(path.join(drifted.galleryRoot, 'index.html'), 'another publisher changed this');
  await assert.rejects(() => publishFixture(drifted), /live index has drifted/);
  assert.equal(await exists(path.join(drifted.galleryRoot, 'new-entry')), false);

  const interrupted = await setup();
  t.after(() => rm(interrupted.root, { recursive: true, force: true }));
  const baseFs = interrupted.fs;
  interrupted.fs = {
    ...baseFs,
    async rename(source, destination) {
      if (destination === path.join(interrupted.galleryRoot, 'index.html')) {
        const error = new Error('simulated index promotion interruption');
        error.code = 'EIO';
        throw error;
      }
      return baseFs.rename(source, destination);
    },
  };

  await assert.rejects(() => publishFixture(interrupted), /simulated index promotion interruption/);
  assert.equal((await readFile(path.join(interrupted.galleryRoot, 'index.html'))).equals(ORIGINAL_INDEX), true);
  assert.equal(await exists(path.join(interrupted.galleryRoot, 'new-entry')), false);
  const journal = JSON.parse(await readFile(
    path.join(interrupted.stateRoot, 'transactions', 'transaction-1', 'transaction.json'),
    'utf8',
  ));
  assert.equal(journal.phase, 'failed-cleaned');
});

test('rollback restores index bytes, removes exactly its slug, and proves lstat plus test absence', async (t) => {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await publishFixture(fixture);

  const localExecutor = createLocalExecutor(fixture.fs);
  const calls = [];
  const executor = {
    async lstat(target) {
      calls.push(['lstat', target]);
      return localExecutor.lstat(target);
    },
    async testAbsent(target) {
      calls.push(['testAbsent', target]);
      return localExecutor.testAbsent(target);
    },
  };

  const result = await rollback({
    galleryRoot: fixture.galleryRoot,
    stateRoot: fixture.stateRoot,
    transactionId: 'transaction-1',
    fs: fixture.fs,
    executor,
    authenticatedVerifier: async () => ({ status: 200, body: 'authenticated gallery fallback' }),
  });

  assert.equal(result.journal.phase, 'rolled-back');
  assert.equal((await readFile(path.join(fixture.galleryRoot, 'index.html'))).equals(ORIGINAL_INDEX), true);
  assert.equal(await exists(path.join(fixture.galleryRoot, 'new-entry')), false);
  assert.equal(await readFile(path.join(fixture.galleryRoot, 'unrelated-artifact', 'keep.txt'), 'utf8'), 'keep this byte-identical');
  assert.deepEqual(calls.map(([method]) => method), ['lstat', 'testAbsent']);
});

test('rollback refuses index or artifact drift before deleting the transaction slug', async (t) => {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await publishFixture(fixture);

  await writeFile(path.join(fixture.galleryRoot, 'index.html'), 'concurrent index drift');
  await assert.rejects(
    () => rollback({
      galleryRoot: fixture.galleryRoot,
      stateRoot: fixture.stateRoot,
      transactionId: 'transaction-1',
      fs: fixture.fs,
      executor: createLocalExecutor(fixture.fs),
      authenticatedVerifier: async () => ({ status: 200, body: 'fallback' }),
    }),
    /live index has drifted/,
  );
  assert.equal(await exists(path.join(fixture.galleryRoot, 'new-entry')), true);

  await writeFile(path.join(fixture.galleryRoot, 'index.html'), fixture.prepared.candidateBytes);
  await writeFile(path.join(fixture.galleryRoot, 'new-entry', 'unexpected.txt'), 'artifact drift');
  await assert.rejects(
    () => rollback({
      galleryRoot: fixture.galleryRoot,
      stateRoot: fixture.stateRoot,
      transactionId: 'transaction-1',
      fs: fixture.fs,
      executor: createLocalExecutor(fixture.fs),
      authenticatedVerifier: async () => ({ status: 200, body: 'fallback' }),
    }),
    /promoted artifact has drifted/,
  );
  assert.equal(await exists(path.join(fixture.galleryRoot, 'new-entry')), true);
});

test('a failed post-publish verifier triggers exact rollback before publish reports failure', async (t) => {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  await assert.rejects(
    () => publishFixture(fixture, {
      postPublishVerifier: async () => {
        throw new Error('authenticated publication verification failed');
      },
    }),
    /authenticated publication verification failed/,
  );

  assert.equal((await readFile(path.join(fixture.galleryRoot, 'index.html'))).equals(ORIGINAL_INDEX), true);
  assert.equal(await exists(path.join(fixture.galleryRoot, 'new-entry')), false);
  const journal = JSON.parse(await readFile(
    path.join(fixture.stateRoot, 'transactions', 'transaction-1', 'transaction.json'),
    'utf8',
  ));
  assert.equal(journal.phase, 'rolled-back');
});

test('authenticated fallback semantics permit a 200 fallback but reject matching content', () => {
  const artifactSha256 = sha256(ARTIFACT_INDEX);
  assert.doesNotThrow(() => verifyAuthenticatedFallback(
    { status: 200, body: 'authenticated gallery fallback' },
    { artifactSha256, forbiddenStrings: ['Neutral artifact', 'unique body marker'] },
  ));

  assert.throws(
    () => verifyAuthenticatedFallback(
      { status: 200, body: 'Neutral artifact is still present in this fallback' },
      { artifactSha256, forbiddenStrings: ['Neutral artifact'] },
    ),
    /artifact-specific content/,
  );
  assert.throws(
    () => verifyAuthenticatedFallback(
      { status: 404, body: ARTIFACT_INDEX },
      { artifactSha256, forbiddenStrings: ['Neutral artifact'] },
    ),
    /artifact checksum/,
  );
});

test('rollback targets a regular transaction path, not sibling paths with a matching prefix', async (t) => {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await publishFixture(fixture);
  await mkdir(path.join(fixture.galleryRoot, 'new-entry-backup'));
  await writeFile(path.join(fixture.galleryRoot, 'new-entry-backup', 'keep.txt'), 'sibling remains');

  await rollback({
    galleryRoot: fixture.galleryRoot,
    stateRoot: fixture.stateRoot,
    transactionId: 'transaction-1',
    fs: fixture.fs,
    executor: createLocalExecutor(fixture.fs),
    authenticatedVerifier: async () => ({ status: 200, body: 'fallback' }),
  });

  const sibling = await lstat(path.join(fixture.galleryRoot, 'new-entry-backup', 'keep.txt'));
  assert.equal(sibling.isFile(), true);
});
