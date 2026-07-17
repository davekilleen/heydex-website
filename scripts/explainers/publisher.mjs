import { createHash } from 'node:crypto';
import {
  lstat as nodeLstat,
  mkdir as nodeMkdir,
  open as nodeOpen,
  readFile as nodeReadFile,
  readdir as nodeReaddir,
  rename as nodeRename,
  rm as nodeRm,
  writeFile as nodeWriteFile,
} from 'node:fs/promises';
import path from 'node:path';

import {
  assertAdapterContract,
  assertSafeSlug,
  prepareGalleryIndex,
  sha256,
  toBuffer,
  validateMetadata,
} from './gallery-index.mjs';

const SAFE_TRANSACTION_ID = /^[a-z0-9][a-z0-9-]{0,95}$/;
const INDEX_NAME = 'index.html';

export class PublisherError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'PublisherError';
  }
}

function fail(message) {
  throw new PublisherError(message);
}

function isNotFound(error) {
  return error?.code === 'ENOENT';
}

function nowIso(now) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    fail('clock must return a valid Date');
  }
  return value.toISOString();
}

function assertTransactionId(transactionId) {
  if (typeof transactionId !== 'string' || !SAFE_TRANSACTION_ID.test(transactionId)) {
    fail('transactionId must be a lowercase, hyphen-separated identifier');
  }
  return transactionId;
}

function isDirectory(stat) {
  return typeof stat?.isDirectory === 'function' && stat.isDirectory();
}

function isFile(stat) {
  return typeof stat?.isFile === 'function' && stat.isFile();
}

function isSymlink(stat) {
  return typeof stat?.isSymbolicLink === 'function' && stat.isSymbolicLink();
}

function childPath(root, ...segments) {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, ...segments);
  if (!resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    fail('computed path escapes its configured root');
  }
  return resolvedPath;
}

async function assertDirectory(fs, target, label) {
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch (error) {
    if (isNotFound(error)) fail(`${label} does not exist`);
    throw error;
  }

  if (isSymlink(stat) || !isDirectory(stat)) fail(`${label} must be a real directory`);
}

async function assertRegularFile(fs, target, label) {
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch (error) {
    if (isNotFound(error)) fail(`${label} does not exist`);
    throw error;
  }

  if (isSymlink(stat) || !isFile(stat)) fail(`${label} must be a regular file`);
}

function assertFilesystem(fs) {
  if (!fs || typeof fs !== 'object') fail('filesystem seam must be an object');
  for (const method of ['lstat', 'mkdir', 'openExclusive', 'readFile', 'readdir', 'rename', 'rm', 'writeFile']) {
    if (typeof fs[method] !== 'function') fail(`filesystem seam is missing ${method}`);
  }
  return fs;
}

function assertExecutor(executor) {
  if (!executor || typeof executor !== 'object') fail('executor seam must be an object');
  for (const method of ['lstat', 'testAbsent']) {
    if (typeof executor[method] !== 'function') fail(`executor seam is missing ${method}`);
  }
  return executor;
}

export function createNodeFilesystem() {
  return {
    lstat: nodeLstat,
    mkdir: nodeMkdir,
    readFile: nodeReadFile,
    readdir: nodeReaddir,
    rename: nodeRename,
    rm: nodeRm,
    writeFile: nodeWriteFile,
    async openExclusive(target, contents) {
      const handle = await nodeOpen(target, 'wx', 0o600);
      try {
        if (contents) await handle.writeFile(contents);
      } finally {
        await handle.close();
      }
    },
  };
}

export function createLocalExecutor(fs = createNodeFilesystem()) {
  return {
    async lstat(target) {
      try {
        const stat = await fs.lstat(target);
        return {
          exists: true,
          type: isSymlink(stat) ? 'symlink' : isDirectory(stat) ? 'directory' : isFile(stat) ? 'file' : 'other',
        };
      } catch (error) {
        if (isNotFound(error)) return { exists: false };
        throw error;
      }
    },
    async testAbsent(target) {
      const result = await this.lstat(target);
      return result.exists === false;
    },
  };
}

async function assertRemoteAbsent(executor, target) {
  const lstatResult = await executor.lstat(target);
  if (!lstatResult || lstatResult.exists !== false) {
    fail('remote lstat did not prove the target is absent');
  }

  if (await executor.testAbsent(target) !== true) {
    fail('remote test ! -e did not prove the target is absent');
  }
}

async function readIndex(fs, galleryRoot) {
  const indexPath = childPath(galleryRoot, INDEX_NAME);
  await assertRegularFile(fs, indexPath, 'gallery index');
  return toBuffer(await fs.readFile(indexPath), 'gallery index');
}

async function checksumTree(fs, root) {
  const hash = createHash('sha256');

  async function visit(target, relative) {
    const stat = await fs.lstat(target);
    if (isSymlink(stat)) fail('artifact tree contains a symbolic link');

    if (isFile(stat)) {
      hash.update(`file\0${relative}\0`);
      hash.update(toBuffer(await fs.readFile(target), `artifact file ${relative}`));
      return;
    }

    if (!isDirectory(stat)) fail('artifact tree contains a non-regular filesystem entry');
    hash.update(`directory\0${relative}\0`);
    const names = [...await fs.readdir(target)].sort();
    for (const name of names) {
      if (name === '.' || name === '..' || name.includes(path.sep)) {
        fail('artifact tree contains an unsafe path component');
      }
      await visit(childPath(root, ...relative.split('/').filter(Boolean), name), `${relative}${name}/`);
    }
  }

  await assertDirectory(fs, root, 'artifact directory');
  await visit(root, '');
  return hash.digest('hex');
}

async function copyTree(fs, source, destination) {
  const stat = await fs.lstat(source);
  if (isSymlink(stat)) fail('artifact source contains a symbolic link');

  if (isFile(stat)) {
    await fs.writeFile(destination, await fs.readFile(source));
    return;
  }

  if (!isDirectory(stat)) fail('artifact source contains a non-regular filesystem entry');
  await fs.mkdir(destination, { recursive: true, mode: 0o700 });
  const names = [...await fs.readdir(source)].sort();
  for (const name of names) {
    if (name === '.' || name === '..' || name.includes(path.sep)) {
      fail('artifact source contains an unsafe path component');
    }
    await copyTree(fs, path.join(source, name), path.join(destination, name));
  }
}

async function atomicWriteJson(fs, target, value) {
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, target);
}

async function writeJournal(fs, journalPath, journal, now) {
  journal.updatedAt = nowIso(now);
  await atomicWriteJson(fs, journalPath, journal);
}

async function setPhase(fs, journalPath, journal, phase, now) {
  journal.phase = phase;
  journal.phases[phase] = nowIso(now);
  await writeJournal(fs, journalPath, journal, now);
}

async function readJournal(fs, journalPath) {
  await assertRegularFile(fs, journalPath, 'transaction journal');
  let parsed;
  try {
    parsed = JSON.parse((await fs.readFile(journalPath)).toString('utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) fail('transaction journal is not valid JSON');
    throw error;
  }

  if (!parsed || parsed.schemaVersion !== 1 || typeof parsed !== 'object') {
    fail('transaction journal has an unsupported schema');
  }

  assertTransactionId(parsed.transactionId);
  assertSafeSlug(parsed.slug, 'transaction journal slug');
  for (const field of [
    'previousIndexSha256',
    'candidateIndexSha256',
    'artifactIndexSha256',
    'artifactTreeSha256',
  ]) {
    if (typeof parsed[field] !== 'string' || !/^[a-f0-9]{64}$/.test(parsed[field])) {
      fail(`transaction journal has invalid ${field}`);
    }
  }

  if (!Array.isArray(parsed.forbiddenStrings) || parsed.forbiddenStrings.some(
    (value) => typeof value !== 'string' || value.length === 0,
  )) {
    fail('transaction journal has invalid authenticated fallback markers');
  }

  return parsed;
}

function serializePrepared(prepared) {
  return {
    adapterFingerprint: prepared.adapterFingerprint,
    adapterVersion: prepared.adapterVersion,
    candidateIndexSha256: prepared.candidateIndexSha256,
    declaredEditRanges: prepared.declaredEditRanges,
    previousIndexSha256: prepared.previousIndexSha256,
  };
}

function assertPrepared(prepared) {
  if (!prepared || typeof prepared !== 'object' || prepared.schemaVersion !== 1) {
    fail('prepared gallery update has an unsupported schema');
  }

  validateMetadata(prepared.metadata);
  toBuffer(prepared.candidateBytes, 'prepared candidateBytes');
  for (const field of ['previousIndexSha256', 'candidateIndexSha256']) {
    if (typeof prepared[field] !== 'string' || !/^[a-f0-9]{64}$/.test(prepared[field])) {
      fail(`prepared gallery update has invalid ${field}`);
    }
  }

  if (typeof prepared.adapterFingerprint !== 'string' || prepared.adapterFingerprint.trim().length === 0) {
    fail('prepared gallery update has an invalid adapter fingerprint');
  }
  if (typeof prepared.adapterVersion !== 'string' || prepared.adapterVersion.trim().length === 0) {
    fail('prepared gallery update has an invalid adapter version');
  }
  if (!Array.isArray(prepared.declaredEditRanges) || prepared.declaredEditRanges.length === 0) {
    fail('prepared gallery update has no declared edit ranges');
  }

  if (sha256(prepared.candidateBytes) !== prepared.candidateIndexSha256) {
    fail('prepared candidate bytes do not match their recorded checksum');
  }

  return prepared;
}

async function removeOnlyTransactionArtifact({ fs, executor, galleryRoot, slug }) {
  const artifactPath = childPath(galleryRoot, slug);
  await fs.rm(artifactPath, { recursive: true, force: false });
  await assertRemoteAbsent(executor, artifactPath);
}

function normalizedForbiddenStrings(metadata, artifactBodyMarker) {
  const strings = [metadata.title];
  if (artifactBodyMarker !== undefined && artifactBodyMarker !== null) {
    if (typeof artifactBodyMarker !== 'string' || artifactBodyMarker.length === 0) {
      fail('artifactBodyMarker must be a non-empty string when supplied');
    }
    strings.push(artifactBodyMarker);
  }
  return strings;
}

export function verifyAuthenticatedFallback(response, { artifactSha256, forbiddenStrings }) {
  if (!response || typeof response !== 'object') fail('authenticated verifier must return a response object');
  if (typeof artifactSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(artifactSha256)) {
    fail('authenticated verifier requires an artifact SHA-256 hash');
  }
  if (!Array.isArray(forbiddenStrings) || forbiddenStrings.some(
    (value) => typeof value !== 'string' || value.length === 0,
  )) {
    fail('authenticated verifier requires non-empty artifact-specific markers');
  }
  const body = typeof response.body === 'string'
    ? Buffer.from(response.body, 'utf8')
    : toBuffer(response.body, 'authenticated response body');
  if (sha256(body) === artifactSha256) {
    fail('authenticated former-artifact response still matches the artifact checksum');
  }

  for (const value of forbiddenStrings) {
    if (body.includes(Buffer.from(value))) {
      fail('authenticated former-artifact response still contains artifact-specific content');
    }
  }

  return {
    bodySha256: sha256(body),
    status: response.status ?? null,
  };
}

async function verifyArtifactSource(fs, artifactDirectory, metadata) {
  await assertDirectory(fs, artifactDirectory, 'artifact directory');
  const artifactIndex = childPath(artifactDirectory, INDEX_NAME);
  await assertRegularFile(fs, artifactIndex, 'artifact index');
  if (sha256(await fs.readFile(artifactIndex)) !== metadata.artifactSha256) {
    fail('artifact index does not match metadata.artifactSha256');
  }
}

async function performRollback({
  fs,
  executor,
  galleryRoot,
  transactionRoot,
  journalPath,
  journal,
  now,
  authenticatedVerifier,
}) {
  if (typeof authenticatedVerifier !== 'function') {
    fail('rollback requires an authenticated former-artifact verifier');
  }

  const indexPath = childPath(galleryRoot, INDEX_NAME);
  const artifactPath = childPath(galleryRoot, journal.slug);
  const previousIndexPath = childPath(transactionRoot, 'previous-index.html');
  const candidateIndexPath = childPath(transactionRoot, 'candidate-index.html');

  await assertRegularFile(fs, previousIndexPath, 'previous index snapshot');
  await assertRegularFile(fs, candidateIndexPath, 'candidate index snapshot');

  const currentIndex = await readIndex(fs, galleryRoot);
  if (sha256(currentIndex) !== journal.candidateIndexSha256) {
    fail('rollback refused because the live index has drifted');
  }

  if (sha256(await fs.readFile(candidateIndexPath)) !== journal.candidateIndexSha256) {
    fail('rollback refused because the transaction candidate snapshot has drifted');
  }

  if (await checksumTree(fs, artifactPath) !== journal.artifactTreeSha256) {
    fail('rollback refused because the promoted artifact has drifted');
  }

  const previousIndex = toBuffer(await fs.readFile(previousIndexPath), 'previous index snapshot');
  if (sha256(previousIndex) !== journal.previousIndexSha256) {
    fail('rollback refused because the previous index snapshot has drifted');
  }

  const rollbackTemporary = childPath(galleryRoot, `.index.rollback-${journal.transactionId}.tmp`);
  await setPhase(fs, journalPath, journal, 'rollback-index-promoting', now);
  await fs.writeFile(rollbackTemporary, previousIndex, { mode: 0o600 });
  if (sha256(await fs.readFile(rollbackTemporary)) !== journal.previousIndexSha256) {
    fail('rollback temporary index checksum mismatch');
  }
  await fs.rename(rollbackTemporary, indexPath);

  if (sha256(await readIndex(fs, galleryRoot)) !== journal.previousIndexSha256) {
    fail('rollback did not restore the byte-identical previous index');
  }

  await setPhase(fs, journalPath, journal, 'rollback-artifact-removing', now);
  await removeOnlyTransactionArtifact({ fs, executor, galleryRoot, slug: journal.slug });

  await setPhase(fs, journalPath, journal, 'rollback-authenticating', now);
  const verification = verifyAuthenticatedFallback(
    await authenticatedVerifier({ slug: journal.slug, artifactSha256: journal.artifactIndexSha256 }),
    {
      artifactSha256: journal.artifactIndexSha256,
      forbiddenStrings: journal.forbiddenStrings,
    },
  );

  await setPhase(fs, journalPath, journal, 'rolled-back', now);
  return { journal: { ...journal }, verification };
}

export function prepare({ indexBytes, metadata, adapter }) {
  return prepareGalleryIndex({ indexBytes, metadata, adapter });
}

export async function publish({
  prepared,
  adapter,
  artifactDirectory,
  galleryRoot,
  stateRoot,
  transactionId,
  artifactBodyMarker,
  postPublishVerifier,
  authenticatedVerifier,
  fs = createNodeFilesystem(),
  executor = createLocalExecutor(fs),
  now = () => new Date(),
}) {
  const validPrepared = assertPrepared(prepared);
  const validAdapter = assertAdapterContract(adapter);
  const validFs = assertFilesystem(fs);
  const validExecutor = assertExecutor(executor);
  const validTransactionId = assertTransactionId(transactionId);
  const validMetadata = validateMetadata(validPrepared.metadata);

  if (typeof postPublishVerifier !== 'function') {
    fail('publish requires a postPublishVerifier');
  }
  if (typeof authenticatedVerifier !== 'function') {
    fail('publish requires an authenticated rollback verifier');
  }

  await assertDirectory(validFs, galleryRoot, 'gallery root');
  await assertDirectory(validFs, stateRoot, 'state root');
  await verifyArtifactSource(validFs, artifactDirectory, validMetadata);

  const transactionRoot = childPath(stateRoot, 'transactions', validTransactionId);
  const stagingRoot = childPath(stateRoot, 'staging', validTransactionId);
  const journalPath = childPath(transactionRoot, 'transaction.json');
  const lockPath = childPath(stateRoot, 'locks', 'publisher.lock');
  const artifactPath = childPath(galleryRoot, validMetadata.slug);
  const stagedArtifactPath = childPath(stagingRoot, validMetadata.slug);
  const stagedIndexPath = childPath(stagingRoot, 'candidate-index.html');

  const transactionsRoot = childPath(stateRoot, 'transactions');
  const stagingParent = childPath(stateRoot, 'staging');
  const locksRoot = childPath(stateRoot, 'locks');
  await validFs.mkdir(transactionsRoot, { recursive: true, mode: 0o700 });
  await validFs.mkdir(stagingParent, { recursive: true, mode: 0o700 });
  await validFs.mkdir(locksRoot, { recursive: true, mode: 0o700 });
  await assertDirectory(validFs, transactionsRoot, 'transaction state root');
  await assertDirectory(validFs, stagingParent, 'staging state root');
  await assertDirectory(validFs, locksRoot, 'lock state root');

  try {
    await validFs.lstat(transactionRoot);
    fail('transactionId already has a transaction journal');
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  const journal = {
    schemaVersion: 1,
    transactionId: validTransactionId,
    slug: validMetadata.slug,
    phase: 'created',
    phases: { created: nowIso(now) },
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
    previousIndexSha256: validPrepared.previousIndexSha256,
    candidateIndexSha256: validPrepared.candidateIndexSha256,
    artifactIndexSha256: validMetadata.artifactSha256,
    artifactTreeSha256: null,
    adapterFingerprint: validPrepared.adapterFingerprint,
    adapterVersion: validPrepared.adapterVersion,
    declaredEditRanges: validPrepared.declaredEditRanges,
    forbiddenStrings: normalizedForbiddenStrings(validMetadata, artifactBodyMarker),
  };

  await validFs.mkdir(transactionRoot, { recursive: false, mode: 0o700 });
  await assertDirectory(validFs, transactionRoot, 'transaction directory');
  await writeJournal(validFs, journalPath, journal, now);

  let lockAcquired = false;
  let artifactPromoted = false;
  let indexPromoted = false;

  try {
    await setPhase(validFs, journalPath, journal, 'locking', now);
    try {
      await validFs.openExclusive(lockPath, `${validTransactionId}\n`);
      lockAcquired = true;
    } catch (error) {
      if (error?.code === 'EEXIST') fail('publisher lock is already held');
      throw error;
    }
    await setPhase(validFs, journalPath, journal, 'locked', now);

    const liveIndex = await readIndex(validFs, galleryRoot);
    if (sha256(liveIndex) !== validPrepared.previousIndexSha256) {
      fail('publish refused because the live index has drifted');
    }
    if (validAdapter.fingerprint(Buffer.from(liveIndex)) !== validPrepared.adapterFingerprint) {
      fail('publish refused because the adapter fingerprint has drifted');
    }
    if (validAdapter.version !== validPrepared.adapterVersion) {
      fail('publish refused because the adapter version has drifted');
    }
    await assertRemoteAbsent(validExecutor, artifactPath);

    await setPhase(validFs, journalPath, journal, 'staging', now);
    await validFs.mkdir(stagingRoot, { recursive: false, mode: 0o700 });
    await copyTree(validFs, artifactDirectory, stagedArtifactPath);
    await validFs.writeFile(stagedIndexPath, validPrepared.candidateBytes, { mode: 0o600 });

    const sourceTreeSha256 = await checksumTree(validFs, artifactDirectory);
    const stagedTreeSha256 = await checksumTree(validFs, stagedArtifactPath);
    if (sourceTreeSha256 !== stagedTreeSha256) fail('staged artifact checksum mismatch');
    if (sha256(await validFs.readFile(stagedIndexPath)) !== validPrepared.candidateIndexSha256) {
      fail('staged candidate index checksum mismatch');
    }
    journal.artifactTreeSha256 = stagedTreeSha256;
    await setPhase(validFs, journalPath, journal, 'staged', now);

    await setPhase(validFs, journalPath, journal, 'snapshotting', now);
    await validFs.writeFile(childPath(transactionRoot, 'previous-index.html'), liveIndex, { mode: 0o600 });
    await validFs.writeFile(
      childPath(transactionRoot, 'candidate-index.html'),
      validPrepared.candidateBytes,
      { mode: 0o600 },
    );
    if (sha256(await validFs.readFile(childPath(transactionRoot, 'previous-index.html'))) !== journal.previousIndexSha256) {
      fail('previous index snapshot checksum mismatch');
    }

    await setPhase(validFs, journalPath, journal, 'artifact-promoting', now);
    await validFs.rename(stagedArtifactPath, artifactPath);
    artifactPromoted = true;
    await setPhase(validFs, journalPath, journal, 'artifact-promoted', now);

    await setPhase(validFs, journalPath, journal, 'index-promoting', now);
    await validFs.rename(stagedIndexPath, childPath(galleryRoot, INDEX_NAME));
    indexPromoted = true;
    await setPhase(validFs, journalPath, journal, 'index-promoted', now);

    if (sha256(await readIndex(validFs, galleryRoot)) !== journal.candidateIndexSha256) {
      fail('candidate index promotion checksum mismatch');
    }

    await postPublishVerifier({
      transactionId: validTransactionId,
      slug: validMetadata.slug,
      artifactIndexSha256: journal.artifactIndexSha256,
      candidateIndexSha256: journal.candidateIndexSha256,
    });
    await setPhase(validFs, journalPath, journal, 'published', now);

    return {
      transactionId: validTransactionId,
      transactionRoot,
      journal: { ...journal },
      prepared: serializePrepared(validPrepared),
    };
  } catch (error) {
    let recoveryError;
    try {
      if (indexPromoted) {
        await performRollback({
          fs: validFs,
          executor: validExecutor,
          galleryRoot,
          transactionRoot,
          journalPath,
          journal,
          now,
          authenticatedVerifier,
        });
      } else if (artifactPromoted) {
        await setPhase(validFs, journalPath, journal, 'cleanup-artifact', now);
        await removeOnlyTransactionArtifact({
          fs: validFs,
          executor: validExecutor,
          galleryRoot,
          slug: validMetadata.slug,
        });
        await setPhase(validFs, journalPath, journal, 'failed-cleaned', now);
      } else {
        await setPhase(validFs, journalPath, journal, 'failed', now);
      }
    } catch (cleanupError) {
      recoveryError = cleanupError;
    }

    if (recoveryError) {
      throw new PublisherError('publication failed and automatic recovery could not be verified', {
        cause: recoveryError,
      });
    }
    throw error;
  } finally {
    if (lockAcquired) await validFs.rm(lockPath, { force: true });
  }
}

export async function rollback({
  galleryRoot,
  stateRoot,
  transactionId,
  authenticatedVerifier,
  fs = createNodeFilesystem(),
  executor = createLocalExecutor(fs),
  now = () => new Date(),
}) {
  const validFs = assertFilesystem(fs);
  const validExecutor = assertExecutor(executor);
  const validTransactionId = assertTransactionId(transactionId);
  if (typeof authenticatedVerifier !== 'function') {
    fail('rollback requires an authenticated former-artifact verifier');
  }

  await assertDirectory(validFs, galleryRoot, 'gallery root');
  await assertDirectory(validFs, stateRoot, 'state root');

  const transactionRoot = childPath(stateRoot, 'transactions', validTransactionId);
  const journalPath = childPath(transactionRoot, 'transaction.json');
  const lockPath = childPath(stateRoot, 'locks', 'publisher.lock');
  await assertDirectory(validFs, transactionRoot, 'transaction directory');
  await validFs.mkdir(childPath(stateRoot, 'locks'), { recursive: true, mode: 0o700 });
  await assertDirectory(validFs, childPath(stateRoot, 'locks'), 'lock state root');

  const journal = await readJournal(validFs, journalPath);
  if (journal.transactionId !== validTransactionId) fail('transaction journal ID does not match its path');

  await setPhase(validFs, journalPath, journal, 'rollback-locking', now);
  try {
    await validFs.openExclusive(lockPath, `rollback-${validTransactionId}\n`);
  } catch (error) {
    if (error?.code === 'EEXIST') fail('publisher lock is already held');
    throw error;
  }

  try {
    await setPhase(validFs, journalPath, journal, 'rollback-preflight', now);
    return await performRollback({
      fs: validFs,
      executor: validExecutor,
      galleryRoot,
      transactionRoot,
      journalPath,
      journal,
      now,
      authenticatedVerifier,
    });
  } finally {
    await validFs.rm(lockPath, { force: true });
  }
}

export const commands = { prepare, publish, rollback };

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.stderr.write(
    'This generic publisher is library-first. Invoke prepare, publish, or rollback with a reviewed adapter and injected filesystem/executor seams.\n',
  );
  process.exitCode = 1;
}
