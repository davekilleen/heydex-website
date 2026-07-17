import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { sha256 } from '../../scripts/explainers/gallery-index.mjs';
import {
  createLocalExecutor,
  createNodeFilesystem,
  createSshExecutor,
  prepare,
  publish,
  rollback,
  runCli,
  verifyFormerArtifactResponse,
} from '../../scripts/explainers/publisher.mjs';

const ORIGINAL_INDEX = Buffer.from('opaque generic gallery index\n');
const ARTIFACT_INDEX = Buffer.from('<!doctype html><title>Neutral artifact</title>\n');
const TEMPORARY_ROOT = '/var/tmp';

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
    version: 'fake-publisher-adapter-v2',
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

function security() {
  return {
    web: {
      uid: process.getuid(),
      gid: process.getgid(),
      directoryMode: 0o755,
      fileMode: 0o644,
    },
    state: {
      uid: process.getuid(),
      gid: process.getgid(),
      directoryMode: 0o700,
      fileMode: 0o600,
    },
    minFreeBytes: 0,
  };
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function setup() {
  const root = await mkdtemp(path.join(TEMPORARY_ROOT, 'heydex-explainer-publisher-'));
  const galleryRoot = path.join(root, 'gallery');
  const stateRoot = path.join(root, 'state');
  const artifactDirectory = path.join(root, 'artifact');
  await mkdir(galleryRoot, { mode: 0o755 });
  await mkdir(stateRoot, { mode: 0o700 });
  await mkdir(artifactDirectory, { mode: 0o700 });
  await chmod(galleryRoot, 0o755);
  await chmod(stateRoot, 0o700);
  await writeFile(path.join(galleryRoot, 'index.html'), ORIGINAL_INDEX, { mode: 0o644 });
  await chmod(path.join(galleryRoot, 'index.html'), 0o644);
  await mkdir(path.join(galleryRoot, 'unrelated-artifact'), { mode: 0o755 });
  await writeFile(path.join(galleryRoot, 'unrelated-artifact', 'keep.txt'), 'keep this byte-identical', { mode: 0o644 });
  await writeFile(path.join(artifactDirectory, 'index.html'), ARTIFACT_INDEX, { mode: 0o600 });

  const metadata = {
    schemaVersion: 1,
    slug: 'new-entry',
    title: 'Neutral artifact',
    summary: 'Neutral publication test artifact',
    createdAt: '2026-07-17T00:00:00.000Z',
    artifactSha256: sha256(ARTIFACT_INDEX),
  };
  const prepared = prepare({ indexBytes: ORIGINAL_INDEX, metadata, adapter: adapter() });
  const fs = createNodeFilesystem();
  return {
    root,
    galleryRoot,
    stateRoot,
    artifactDirectory,
    metadata,
    prepared,
    adapter: adapter(),
    security: security(),
    fs,
  };
}

async function publishFixture(fixture, overrides = {}) {
  const fs = overrides.fs ?? fixture.fs;
  return publish({
    prepared: fixture.prepared,
    adapter: fixture.adapter,
    artifactDirectory: fixture.artifactDirectory,
    galleryRoot: fixture.galleryRoot,
    stateRoot: fixture.stateRoot,
    transactionId: 'transaction-1',
    security: fixture.security,
    fs,
    executor: createLocalExecutor(fs),
    postPublishVerifier: async () => ({ status: 200 }),
    authenticatedVerifier: async () => ({ status: 200, body: 'authenticated gallery fallback' }),
    ...overrides,
  });
}

function mode(stat) {
  return stat.mode & 0o777;
}

async function assertPreparedRejected(t, mutate, expected) {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await assert.rejects(() => publishFixture(fixture, { prepared: mutate(fixture.prepared) }), expected);
  assert.equal((await readFile(path.join(fixture.galleryRoot, 'index.html'))).equals(ORIGINAL_INDEX), true);
  assert.equal(await exists(path.join(fixture.galleryRoot, 'new-entry')), false);
}

async function assertRollbackRefuses(t, mutate) {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await publishFixture(fixture);
  await mutate(fixture);
  await assert.rejects(
    () => rollback({
      galleryRoot: fixture.galleryRoot,
      stateRoot: fixture.stateRoot,
      transactionId: 'transaction-1',
      security: fixture.security,
      fs: fixture.fs,
      executor: createLocalExecutor(fixture.fs),
      authenticatedVerifier: async () => ({ status: 200, body: 'fallback body' }),
    }),
    /drifted/,
  );
  assert.equal(await exists(path.join(fixture.galleryRoot, 'new-entry')), true);
}

test('publish regenerates reviewed bytes under lock and promotes serve-safe metadata', async (t) => {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const calls = [];
  const baseFs = fixture.fs;
  const fs = {
    ...baseFs,
    async chmod(target, value) {
      calls.push(['chmod', path.basename(target), value]);
      return baseFs.chmod(target, value);
    },
    async chown(target, uid, gid) {
      calls.push(['chown', path.basename(target), uid, gid]);
      return baseFs.chown(target, uid, gid);
    },
    async fsyncDirectory(target) {
      calls.push(['fsyncDirectory', path.basename(target)]);
      return baseFs.fsyncDirectory(target);
    },
  };

  const result = await publishFixture(fixture, { fs });
  const journal = JSON.parse(await readFile(path.join(result.transactionRoot, 'transaction.json'), 'utf8'));
  const promotedIndex = await lstat(path.join(fixture.galleryRoot, 'index.html'));
  const promotedArtifact = await lstat(path.join(fixture.galleryRoot, 'new-entry'));
  const promotedArtifactIndex = await lstat(path.join(fixture.galleryRoot, 'new-entry', 'index.html'));

  assert.equal(journal.phase, 'published');
  assert.equal((await readFile(path.join(fixture.galleryRoot, 'index.html'))).equals(fixture.prepared.candidateBytes), true);
  assert.equal(mode(promotedIndex), 0o644);
  assert.equal(mode(promotedArtifact), 0o755);
  assert.equal(mode(promotedArtifactIndex), 0o644);
  assert.equal(promotedIndex.uid, process.getuid());
  assert.equal(promotedIndex.gid, process.getgid());
  assert.equal(await readFile(path.join(fixture.galleryRoot, 'unrelated-artifact', 'keep.txt'), 'utf8'), 'keep this byte-identical');
  assert.equal(calls.some(([name]) => name === 'chmod'), true);
  assert.equal(calls.some(([name]) => name === 'chown'), true);
  assert.equal(calls.some(([name]) => name === 'fsyncDirectory'), true);
});

test('publish rejects tampered reviewed candidate bytes', async (t) => {
  await assertPreparedRejected(
    t,
    (value) => ({ ...value, candidateBytes: Buffer.from('tampered'), candidateIndexSha256: sha256(Buffer.from('tampered')) }),
    /reviewed candidateIndexSha256 no longer matches/,
  );
});

test('publish rejects tampered reviewed declared edit ranges', async (t) => {
  await assertPreparedRejected(
    t,
    (value) => ({ ...value, declaredEditRanges: [{ beforeStart: 0, beforeEnd: 0, afterStart: 0, afterEnd: 1 }] }),
    /reviewed declaredEditRanges no longer matches/,
  );
});

test('publish rejects tampered reviewed candidate inventory', async (t) => {
  await assertPreparedRejected(
    t,
    (value) => ({ ...value, candidateEntries: [{ slug: 'other-entry' }] }),
    /reviewed candidateEntries no longer matches/,
  );
});

test('publish rejects an artifact whose root index does not match reviewed metadata', async (t) => {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await writeFile(path.join(fixture.artifactDirectory, 'index.html'), 'artifact index drift');

  await assert.rejects(() => publishFixture(fixture), /artifact source index does not match metadata/);
  assert.equal((await readFile(path.join(fixture.galleryRoot, 'index.html'))).equals(ORIGINAL_INDEX), true);
  assert.equal(await exists(path.join(fixture.galleryRoot, 'new-entry')), false);
});

test('publish refuses a pre-existing artifact before any promotion', async (t) => {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await mkdir(path.join(fixture.galleryRoot, 'new-entry'));

  await assert.rejects(() => publishFixture(fixture), /artifact destination already exists/);
  assert.equal((await readFile(path.join(fixture.galleryRoot, 'index.html'))).equals(ORIGINAL_INDEX), true);
});

test('publish refuses an existing publisher lock before mutation', async (t) => {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await mkdir(path.join(fixture.stateRoot, 'locks'), { mode: 0o700 });
  await chmod(path.join(fixture.stateRoot, 'locks'), 0o700);
  await writeFile(path.join(fixture.stateRoot, 'locks', 'publisher.lock'), 'other publisher', { mode: 0o600 });

  await assert.rejects(() => publishFixture(fixture), /publisher lock is already held/);
  assert.equal((await readFile(path.join(fixture.galleryRoot, 'index.html'))).equals(ORIGINAL_INDEX), true);
});

test('publish requires lstat and test ! -e absence evidence before staging', async (t) => {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const executor = {
    async lstat() { return { exists: false }; },
    async testAbsent() { return false; },
  };

  await assert.rejects(() => publishFixture(fixture, { executor }), /remote test ! -e did not prove/);
  assert.equal(await exists(path.join(fixture.galleryRoot, 'new-entry')), false);
});

test('publish rejects a staged index checksum mismatch without touching the gallery', async (t) => {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const baseFs = fixture.fs;
  const fs = {
    ...baseFs,
    async writeAtomic(options) {
      const result = await baseFs.writeAtomic(options);
      if (options.filename === 'candidate-index.html' && options.directory.includes(`${path.sep}staging${path.sep}`)) {
        await writeFile(result, 'corrupted staged candidate');
      }
      return result;
    },
  };

  await assert.rejects(() => publishFixture(fixture, { fs }), /staged candidate index checksum mismatch/);
  assert.equal((await readFile(path.join(fixture.galleryRoot, 'index.html'))).equals(ORIGINAL_INDEX), true);
  assert.equal(await exists(path.join(fixture.galleryRoot, 'new-entry')), false);
});

test('rename errors after artifact promotion reconcile exact artifact cleanup from durable state', async (t) => {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const baseFs = fixture.fs;
  let interrupted = false;
  const fs = {
    ...baseFs,
    async renameNoReplace(source, destination) {
      await baseFs.renameNoReplace(source, destination);
      if (!interrupted) {
        interrupted = true;
        throw new Error('rename reported interruption after effect');
      }
    },
  };

  await assert.rejects(() => publishFixture(fixture, { fs }), /rename reported interruption after effect/);
  assert.equal((await readFile(path.join(fixture.galleryRoot, 'index.html'))).equals(ORIGINAL_INDEX), true);
  assert.equal(await exists(path.join(fixture.galleryRoot, 'new-entry')), false);
});

test('rename errors after index promotion restore byte-identical prior index and remove only the slug', async (t) => {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const baseFs = fixture.fs;
  let interrupted = false;
  const fs = {
    ...baseFs,
    async renameReplace(source, destination) {
      await baseFs.renameReplace(source, destination);
      if (destination === path.join(fixture.galleryRoot, 'index.html') && !interrupted) {
        interrupted = true;
        throw new Error('index rename reported interruption after effect');
      }
    },
  };

  await assert.rejects(() => publishFixture(fixture, { fs }), /index rename reported interruption after effect/);
  assert.equal((await readFile(path.join(fixture.galleryRoot, 'index.html'))).equals(ORIGINAL_INDEX), true);
  assert.equal(await exists(path.join(fixture.galleryRoot, 'new-entry')), false);
  assert.equal(await readFile(path.join(fixture.galleryRoot, 'unrelated-artifact', 'keep.txt'), 'utf8'), 'keep this byte-identical');
});

test('durable phase journal recovers interruptions at every mutation boundary', async (t) => {
  for (const phase of [
    'staging',
    'staged',
    'snapshotting',
    'snapshotted',
    'artifact-promoting',
    'artifact-promoted',
    'index-promoting',
    'index-promoted',
    'verifying',
  ]) {
    const fixture = await setup();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    let thrown = false;
    await assert.rejects(
      () => publishFixture(fixture, {
        phaseHook(current) {
          if (current === phase && !thrown) {
            thrown = true;
            throw new Error(`interrupt ${phase}`);
          }
        },
      }),
      new RegExp(`interrupt ${phase}`),
    );
    assert.equal((await readFile(path.join(fixture.galleryRoot, 'index.html'))).equals(ORIGINAL_INDEX), true, phase);
    assert.equal(await exists(path.join(fixture.galleryRoot, 'new-entry')), false, phase);
  }
});

test('a late index drift after artifact promotion removes only the transaction artifact', async (t) => {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const baseFs = fixture.fs;
  const fs = {
    ...baseFs,
    async renameNoReplace(source, destination) {
      await baseFs.renameNoReplace(source, destination);
      await writeFile(path.join(fixture.galleryRoot, 'index.html'), 'another publisher changed the index');
      await chmod(path.join(fixture.galleryRoot, 'index.html'), 0o644);
    },
  };

  await assert.rejects(() => publishFixture(fixture, { fs }), /live index has drifted/);
  assert.equal(await exists(path.join(fixture.galleryRoot, 'new-entry')), false);
});

test('atomic no-replace promotion preserves an artifact that appears after preflight', async (t) => {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const baseFs = fixture.fs;
  const externalArtifact = path.join(fixture.galleryRoot, 'new-entry');
  const fs = {
    ...baseFs,
    async renameNoReplace(source, destination) {
      await mkdir(destination, { mode: 0o755 });
      await writeFile(path.join(destination, 'external.txt'), 'another publisher artifact');
      return baseFs.renameNoReplace(source, destination);
    },
  };

  await assert.rejects(() => publishFixture(fixture, { fs }), /durable recovery could not be verified/);
  assert.equal((await readFile(path.join(externalArtifact, 'external.txt'), 'utf8')), 'another publisher artifact');
  assert.equal((await readFile(path.join(fixture.galleryRoot, 'index.html'))).equals(ORIGINAL_INDEX), true);
});

test('rollback preserves audited index metadata, deletion scope, and dual absence evidence', async (t) => {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await publishFixture(fixture);
  await mkdir(path.join(fixture.galleryRoot, 'new-entry-backup'), { mode: 0o755 });
  await writeFile(path.join(fixture.galleryRoot, 'new-entry-backup', 'keep.txt'), 'sibling remains');
  const baseExecutor = createLocalExecutor(fixture.fs);
  const calls = [];
  const executor = {
    async lstat(target) {
      calls.push(['lstat', target]);
      return baseExecutor.lstat(target);
    },
    async testAbsent(target) {
      calls.push(['testAbsent', target]);
      return baseExecutor.testAbsent(target);
    },
  };

  const result = await rollback({
    galleryRoot: fixture.galleryRoot,
    stateRoot: fixture.stateRoot,
    transactionId: 'transaction-1',
    security: fixture.security,
    fs: fixture.fs,
    executor,
    authenticatedVerifier: async () => ({ status: 200, body: 'authenticated gallery fallback' }),
  });

  assert.equal(result.journal.phase, 'rolled-back');
  assert.equal((await readFile(path.join(fixture.galleryRoot, 'index.html'))).equals(ORIGINAL_INDEX), true);
  const restoredIndex = await lstat(path.join(fixture.galleryRoot, 'index.html'));
  assert.equal(mode(restoredIndex), 0o644);
  assert.equal(restoredIndex.uid, process.getuid());
  assert.equal(restoredIndex.gid, process.getgid());
  assert.equal(await exists(path.join(fixture.galleryRoot, 'new-entry')), false);
  assert.equal(await readFile(path.join(fixture.galleryRoot, 'new-entry-backup', 'keep.txt'), 'utf8'), 'sibling remains');
  assert.deepEqual(calls.map(([name]) => name), ['lstat', 'testAbsent']);
});

test('rollback refuses live index drift', async (t) => {
  await assertRollbackRefuses(t, (fixture) => writeFile(path.join(fixture.galleryRoot, 'index.html'), 'external drift'));
});

test('rollback refuses promoted artifact drift', async (t) => {
  await assertRollbackRefuses(t, (fixture) => writeFile(path.join(fixture.galleryRoot, 'new-entry', 'unexpected.txt'), 'artifact drift'));
});

test('rollback refuses candidate transaction snapshot drift', async (t) => {
  await assertRollbackRefuses(
    t,
    (fixture) => writeFile(
      path.join(fixture.stateRoot, 'transactions', 'transaction-1', 'candidate-index.html'),
      'snapshot drift',
    ),
  );
});

test('preflight rejects an ancestor symbolic-link root component', async (t) => {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const linkedParent = path.join(fixture.root, 'linked-parent');
  await symlink(fixture.root, linkedParent);
  await assert.rejects(() => publishFixture(fixture, { stateRoot: path.join(linkedParent, 'state') }), /symbolic-link/);
});

test('preflight rejects a nested state root', async (t) => {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const nestedState = path.join(fixture.galleryRoot, 'nested-state');
  await mkdir(nestedState, { mode: 0o700 });
  await chmod(nestedState, 0o700);
  await assert.rejects(() => publishFixture(fixture, { stateRoot: nestedState }), /disjoint/);
});

test('preflight rejects unsafe state root mode', async (t) => {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await chmod(fixture.stateRoot, 0o755);
  await assert.rejects(() => publishFixture(fixture), /ownership or mode/);
});

test('preflight rejects insufficient filesystem space', async (t) => {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const lowSpaceFs = { ...fixture.fs, async statfs() { return { bsize: 4096, bavail: 0 }; } };
  await assert.rejects(() => publishFixture(fixture, { fs: lowSpaceFs }), /insufficient free space/);
});

test('preflight rejects state storage on another filesystem device', async (t) => {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const baseFs = fixture.fs;
  const crossDeviceFs = {
    ...baseFs,
    async lstat(target) {
      const stat = await baseFs.lstat(target);
      if (target === fixture.stateRoot) return new Proxy(stat, { get(value, key) { return key === 'dev' ? value.dev + 1 : value[key]; } });
      return stat;
    },
  };
  await assert.rejects(() => publishFixture(fixture, { fs: crossDeviceFs }), /same filesystem device/);
});

test('unique no-follow temporary writes do not follow symlinks or replace pre-existing targets', async (t) => {
  const root = await mkdtemp(path.join(TEMPORARY_ROOT, 'heydex-explainer-temp-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outside = path.join(root, 'outside');
  await writeFile(outside, 'do not overwrite');
  const names = ['collision', 'safe'];
  await symlink(outside, path.join(root, '.receipt.collision.tmp'));
  const fs = createNodeFilesystem({ randomId: () => names.shift() });

  await fs.writeAtomic({
    directory: root,
    filename: 'receipt',
    contents: 'safe contents',
    mode: 0o600,
    uid: process.getuid(),
    gid: process.getgid(),
    replace: false,
  });
  assert.equal(await readFile(outside, 'utf8'), 'do not overwrite');
  assert.equal(await readFile(path.join(root, 'receipt'), 'utf8'), 'safe contents');
  await symlink(outside, path.join(root, 'occupied'));
  await assert.rejects(
    () => fs.writeAtomic({
      directory: root,
      filename: 'occupied',
      contents: 'must not follow',
      mode: 0o600,
      uid: process.getuid(),
      gid: process.getgid(),
      replace: false,
    }),
    /already exists/,
  );
});

test('atomic no-replace promotion preserves non-existence errors', async (t) => {
  const root = await mkdtemp(path.join(TEMPORARY_ROOT, 'heydex-explainer-rename-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  await writeFile(source, 'contents');
  const fs = createNodeFilesystem();

  await assert.rejects(
    () => fs.renameNoReplace(source, path.join(root, 'missing-parent', 'destination')),
    (error) => error?.code === 'ENOENT' && error?.message === 'atomic no-replace rename failed: ENOENT',
  );
  assert.equal(await exists(source), true);
});

test('former artifact response accepts a 200 fallback only when it does not match artifact content', () => {
  const artifactSha256 = sha256(ARTIFACT_INDEX);
  assert.doesNotThrow(() => verifyFormerArtifactResponse(
    { status: 200, body: 'authenticated gallery fallback' },
    { artifactSha256, forbiddenStrings: ['Neutral artifact', 'unique marker'] },
  ));
  assert.throws(
    () => verifyFormerArtifactResponse(
      { status: 200, body: 'Neutral artifact remains visible' },
      { artifactSha256, forbiddenStrings: ['Neutral artifact'] },
    ),
    /artifact-specific content/,
  );
  assert.throws(
    () => verifyFormerArtifactResponse(
      { status: 404, body: ARTIFACT_INDEX },
      { artifactSha256, forbiddenStrings: ['Neutral artifact'] },
    ),
    /artifact checksum/,
  );
});

test('SSH executor accepts a key-file path only and never logs or accepts key material', async () => {
  const calls = [];
  const keyMaterialSentinel = 'KEY-MATERIAL-SENTINEL-MUST-NOT-APPEAR';
  const executor = createSshExecutor({
    keyFile: '/var/tmp/review-key',
    host: 'example.invalid',
    user: 'publisher',
    async run(command, args) {
      calls.push({ command, args });
      return { exists: false };
    },
  });
  await executor.lstat('/var/www/explainers/new-entry');
  await executor.testAbsent('/var/www/explainers/new-entry');
  await assert.rejects(
    () => executor.lstat('/var/www/explainers/new-entry;unsafe'),
    /remote path must be a normalized absolute path with safe characters/,
  );

  assert.equal(calls.length, 2);
  assert.equal(calls.every(({ command }) => command === 'ssh'), true);
  assert.equal(calls.every(({ args }) => args.includes('/var/tmp/review-key')), true);
  assert.equal(JSON.stringify(calls).includes(keyMaterialSentinel), false);
  assert.throws(
    () => createSshExecutor({ keyFile: keyMaterialSentinel, host: 'example.invalid', user: 'publisher', run() {} }),
    /key-file path/,
  );
});

test('path-based CLI prepares, publishes, and rolls back through a reviewed key-file seam', async (t) => {
  const fixture = await setup();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const indexPath = path.join(fixture.galleryRoot, 'index.html');
  const metadataPath = path.join(fixture.root, 'metadata.json');
  const adapterPath = path.join(fixture.root, 'adapter.mjs');
  const executorPath = path.join(fixture.root, 'executor.mjs');
  const securityPath = path.join(fixture.root, 'security.json');
  const outputPath = path.join(fixture.root, 'prepared.json');
  await writeFile(metadataPath, JSON.stringify({
    schemaVersion: 1,
    slug: 'new-entry',
    title: 'Neutral title',
    summary: 'Neutral summary',
    createdAt: '2026-07-17T00:00:00.000Z',
    artifactSha256: sha256(ARTIFACT_INDEX),
  }));
  await writeFile(securityPath, JSON.stringify(fixture.security));
  await writeFile(adapterPath, `
    export default {
      version: 'cli-fixture',
      fingerprint: () => 'fixture',
      inventory(bytes) {
        return bytes.toString('utf8').endsWith('new-entry') ? [{ slug: 'new-entry' }] : [];
      },
      createCandidate({ indexBytes, metadata }) {
        const candidateBytes = Buffer.concat([indexBytes, Buffer.from(metadata.slug)]);
        return {
          candidateBytes,
          declaredEditRanges: [{ beforeStart: indexBytes.length, beforeEnd: indexBytes.length, afterStart: indexBytes.length, afterEnd: candidateBytes.length }],
          previousEntries: [],
          candidateEntries: [{ slug: metadata.slug }],
        };
      },
    };
  `);
  await writeFile(executorPath, `
    import { createLocalExecutor, createNodeFilesystem } from ${JSON.stringify(new URL('../../scripts/explainers/publisher.mjs', import.meta.url).href)};
    export function createPublisherSeams({ keyFile }) {
      if (keyFile !== '/var/tmp/reviewed-key-file') throw new Error('key contents were not accepted');
      const fs = createNodeFilesystem();
      return {
        fs,
        executor: createLocalExecutor(fs),
        postPublishVerifier: async () => ({ status: 200 }),
        authenticatedVerifier: async () => ({ status: 200, body: 'authenticated gallery fallback' }),
      };
    }
  `);
  const output = [];
  await runCli(['prepare', '--index', indexPath, '--metadata', metadataPath, '--adapter', adapterPath, '--output', outputPath], {
    stdout: { write: (value) => output.push(value) },
    stderr: { write() {} },
  });
  assert.equal(await exists(outputPath), true);
  assert.deepEqual(output, [`${outputPath}\n`]);
  await assert.rejects(() => runCli(['publish', '--executor-module', executorPath]), /requires --key-file/);
  await assert.rejects(() => runCli([
    'rollback',
    '--key-file', '/var/tmp/reviewed-key-file',
    '--gallery-root', fixture.galleryRoot,
    '--state-root', fixture.stateRoot,
    '--transaction', 'transaction-1',
    '--security', securityPath,
  ]), /requires --executor-module/);

  await runCli([
    'publish',
    '--prepared', outputPath,
    '--adapter', adapterPath,
    '--artifact-dir', fixture.artifactDirectory,
    '--gallery-root', fixture.galleryRoot,
    '--state-root', fixture.stateRoot,
    '--transaction', 'transaction-1',
    '--security', securityPath,
    '--key-file', '/var/tmp/reviewed-key-file',
    '--executor-module', executorPath,
  ]);
  assert.equal(await exists(path.join(fixture.galleryRoot, 'new-entry')), true);
  await runCli([
    'rollback',
    '--gallery-root', fixture.galleryRoot,
    '--state-root', fixture.stateRoot,
    '--transaction', 'transaction-1',
    '--security', securityPath,
    '--key-file', '/var/tmp/reviewed-key-file',
    '--executor-module', executorPath,
  ]);
  assert.equal(await exists(path.join(fixture.galleryRoot, 'new-entry')), false);
});
