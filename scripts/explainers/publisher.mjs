import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmod as nodeChmod,
  chown as nodeChown,
  constants as fsConstants,
  lstat as nodeLstat,
  mkdir as nodeMkdir,
  mkdtemp as nodeMkdtemp,
  open as nodeOpen,
  readFile as nodeReadFile,
  readdir as nodeReaddir,
  realpath as nodeRealpath,
  rename as nodeRename,
  rm as nodeRm,
  statfs as nodeStatfs,
} from 'node:fs/promises';
import { constants as osConstants, tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  assertAdapterContract,
  assertSafeSlug,
  prepareGalleryIndex,
  sha256,
  toBuffer,
  validateMetadata,
} from './gallery-index.mjs';

const executeFile = promisify(execFile);
const INDEX_NAME = 'index.html';
const SAFE_TRANSACTION_ID = /^[a-z0-9][a-z0-9-]{0,95}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const TEMP_ATTEMPTS = 16;
const LEASE_SCHEMA_VERSION = 1;

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

function modeOf(stat) {
  return stat.mode & 0o777;
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

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('record contains a non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!isPlainObject(value)) fail('record contains a non-JSON value');
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
}

function sameJson(left, right) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function childPath(root, ...segments) {
  const absoluteRoot = path.resolve(root);
  const resolved = path.resolve(absoluteRoot, ...segments);
  if (!resolved.startsWith(`${absoluteRoot}${path.sep}`)) fail('computed path escapes its configured root');
  return resolved;
}

function assertTransactionId(transactionId) {
  if (typeof transactionId !== 'string' || !SAFE_TRANSACTION_ID.test(transactionId)) {
    fail('transactionId must be a lowercase, hyphen-separated identifier');
  }
  return transactionId;
}

function nowIso(now) {
  const date = now();
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) fail('clock must return a valid Date');
  return date.toISOString();
}

function assertFilename(filename) {
  if (typeof filename !== 'string' || filename.length === 0 || filename.includes(path.sep) || filename === '.' || filename === '..') {
    fail('atomic write filename must be one safe path component');
  }
  return filename;
}

function normalizeMetadata(stat) {
  if (!Number.isInteger(stat?.uid) || !Number.isInteger(stat?.gid)) {
    fail('filesystem metadata must include numeric uid and gid');
  }
  return { uid: stat.uid, gid: stat.gid, mode: modeOf(stat) };
}

function assertAuditedIndexMetadata(metadata, label) {
  if (
    !isPlainObject(metadata)
    || !Number.isInteger(metadata.uid)
    || !Number.isInteger(metadata.gid)
    || metadata.mode !== 0o644
  ) {
    fail(`${label} has unsafe index metadata`);
  }
  return metadata;
}

function normalizeSecurity(security) {
  if (!isPlainObject(security)) fail('security policy is required');
  const normalized = {};
  for (const [area, expectedModes] of Object.entries({
    web: { directoryMode: 0o755, fileMode: 0o644 },
    state: { directoryMode: 0o700, fileMode: 0o600 },
  })) {
    const policy = security[area];
    if (!isPlainObject(policy) || !Number.isInteger(policy.uid) || !Number.isInteger(policy.gid)) {
      fail(`security.${area} must declare numeric uid and gid`);
    }
    for (const [field, expected] of Object.entries(expectedModes)) {
      if (policy[field] !== expected) fail(`security.${area}.${field} must be ${expected.toString(8)}`);
    }
    normalized[area] = { ...policy };
  }
  if (!Number.isSafeInteger(security.minFreeBytes) || security.minFreeBytes < 0) {
    fail('security.minFreeBytes must be a non-negative safe integer');
  }
  return { ...normalized, minFreeBytes: security.minFreeBytes };
}

function assertFilesystem(fs) {
  if (!fs || typeof fs !== 'object') fail('filesystem seam must be an object');
  for (const method of [
    'chmod', 'chown', 'fsyncDirectory', 'lstat', 'mkdir', 'readFile', 'readdir',
    'realpath', 'renameExchange', 'renameNoReplace', 'renameReplace', 'rm', 'statfs', 'writeAtomic',
    'writeLeaseTemp',
  ]) {
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

async function lstatOrNull(fs, target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function assertRegularFile(fs, target, label) {
  const stat = await lstatOrNull(fs, target);
  if (stat === null) fail(`${label} does not exist`);
  if (isSymlink(stat) || !isFile(stat)) fail(`${label} must be a regular file`);
  return stat;
}

async function assertDirectory(fs, target, label) {
  const stat = await lstatOrNull(fs, target);
  if (stat === null) fail(`${label} does not exist`);
  if (isSymlink(stat) || !isDirectory(stat)) fail(`${label} must be a real directory`);
  return stat;
}

async function assertNoSymlinkComponents(fs, target, label) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let cursor = parsed.root;
  for (const component of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    const stat = await lstatOrNull(fs, cursor);
    if (stat === null) fail(`${label} has a missing path component`);
    if (isSymlink(stat)) fail(`${label} has a symbolic-link path component`);
  }
}

function assertDisjointRoots(...roots) {
  for (let outerIndex = 0; outerIndex < roots.length; outerIndex += 1) {
    for (let innerIndex = outerIndex + 1; innerIndex < roots.length; innerIndex += 1) {
      const outer = roots[outerIndex];
      const inner = roots[innerIndex];
      if (outer === inner || inner.startsWith(`${outer}${path.sep}`) || outer.startsWith(`${inner}${path.sep}`)) {
        fail('gallery, state, and artifact roots must be canonical and disjoint');
      }
    }
  }
}

async function canonicalDirectory(fs, target, label) {
  if (typeof target !== 'string' || !path.isAbsolute(target)) fail(`${label} must be an absolute path`);
  const absolute = path.resolve(target);
  await assertNoSymlinkComponents(fs, absolute, label);
  const real = await fs.realpath(absolute);
  if (real !== absolute) fail(`${label} must not resolve through a symbolic link`);
  const stat = await assertDirectory(fs, absolute, label);
  return { path: absolute, stat };
}

function assertExpectedMetadata(stat, expected, label, expectedMode) {
  const actual = normalizeMetadata(stat);
  if (actual.uid !== expected.uid || actual.gid !== expected.gid || actual.mode !== expectedMode) {
    fail(`${label} ownership or mode does not match the security policy`);
  }
  return actual;
}

function statfsFreeBytes(statfs) {
  const bsize = Number(statfs?.bsize);
  const bavail = Number(statfs?.bavail);
  if (!Number.isSafeInteger(bsize) || !Number.isSafeInteger(bavail) || bsize < 1 || bavail < 0) {
    fail('statfs seam returned invalid available-space metadata');
  }
  const bytes = bsize * bavail;
  if (!Number.isSafeInteger(bytes)) fail('available filesystem space exceeds safe integer range');
  return bytes;
}

async function readIndex(fs, galleryRoot) {
  const indexPath = childPath(galleryRoot, INDEX_NAME);
  const stat = await assertRegularFile(fs, indexPath, 'gallery index');
  return { bytes: toBuffer(await fs.readFile(indexPath), 'gallery index'), stat };
}

async function checksumTree(fs, root) {
  const hash = createHash('sha256');
  let bytes = 0;

  async function visit(target, relative) {
    const stat = await fs.lstat(target);
    if (isSymlink(stat)) fail('artifact tree contains a symbolic link');
    if (isFile(stat)) {
      const contents = toBuffer(await fs.readFile(target), `artifact file ${relative}`);
      hash.update(`file\0${relative}\0`);
      hash.update(contents);
      bytes += contents.length;
      return;
    }
    if (!isDirectory(stat)) fail('artifact tree contains a non-regular filesystem entry');
    hash.update(`directory\0${relative}\0`);
    for (const name of [...await fs.readdir(target)].sort()) {
      assertFilename(name);
      await visit(path.join(target, name), `${relative}${name}/`);
    }
  }

  await assertDirectory(fs, root, 'artifact directory');
  await visit(root, '');
  return { sha256: hash.digest('hex'), bytes };
}

async function checksumArtifactIndex(fs, artifactRoot, label) {
  const indexPath = childPath(artifactRoot, INDEX_NAME);
  await assertRegularFile(fs, indexPath, `${label} index`);
  return sha256(await fs.readFile(indexPath));
}

async function artifactStateAt(fs, artifactPath, journal, security, label) {
  const stat = await lstatOrNull(fs, artifactPath);
  if (stat === null) return 'absent';
  if (isSymlink(stat) || !isDirectory(stat)) return 'drift';
  try {
    await assertTreeMetadata(fs, artifactPath, security.web, label);
    const tree = await checksumTree(fs, artifactPath);
    const indexSha256 = await checksumArtifactIndex(fs, artifactPath, label);
    return tree.sha256 === journal.artifactTreeSha256 && indexSha256 === journal.artifactIndexSha256
      ? 'candidate'
      : 'drift';
  } catch (error) {
    if (error instanceof PublisherError) return 'drift';
    throw error;
  }
}

async function copyTree(fs, source, destination, metadata) {
  const stat = await fs.lstat(source);
  if (isSymlink(stat)) fail('artifact source contains a symbolic link');
  if (isFile(stat)) {
    await fs.writeAtomic({
      directory: path.dirname(destination),
      filename: path.basename(destination),
      contents: await fs.readFile(source),
      mode: metadata.fileMode,
      uid: metadata.uid,
      gid: metadata.gid,
      replace: false,
    });
    return;
  }
  if (!isDirectory(stat)) fail('artifact source contains a non-regular filesystem entry');
  await fs.mkdir(destination, { recursive: false, mode: metadata.directoryMode });
  await fs.chown(destination, metadata.uid, metadata.gid);
  await fs.chmod(destination, metadata.directoryMode);
  await fs.fsyncDirectory(path.dirname(destination));
  for (const name of [...await fs.readdir(source)].sort()) {
    assertFilename(name);
    await copyTree(fs, path.join(source, name), path.join(destination, name), metadata);
  }
  await fs.fsyncDirectory(destination);
}

async function assertTreeMetadata(fs, root, metadata, label = 'artifact tree') {
  const stat = await fs.lstat(root);
  if (isSymlink(stat)) fail(`${label} contains a symbolic link`);
  if (isFile(stat)) {
    assertExpectedMetadata(stat, metadata, label, metadata.fileMode);
    return;
  }
  if (!isDirectory(stat)) fail(`${label} contains a non-regular filesystem entry`);
  assertExpectedMetadata(stat, metadata, label, metadata.directoryMode);
  for (const name of await fs.readdir(root)) {
    assertFilename(name);
    await assertTreeMetadata(fs, path.join(root, name), metadata, label);
  }
}

async function makeStateDirectory(fs, target, stateSecurity) {
  await fs.mkdir(target, { recursive: false, mode: stateSecurity.directoryMode });
  await fs.chown(target, stateSecurity.uid, stateSecurity.gid);
  await fs.chmod(target, stateSecurity.directoryMode);
  await fs.fsyncDirectory(path.dirname(target));
  assertExpectedMetadata(
    await assertDirectory(fs, target, 'transaction state directory'),
    stateSecurity,
    'transaction state directory',
    stateSecurity.directoryMode,
  );
}

async function ensureStateDirectory(fs, target, stateSecurity, label) {
  const stat = await lstatOrNull(fs, target);
  if (stat === null) {
    await makeStateDirectory(fs, target, stateSecurity);
    return;
  }
  assertExpectedMetadata(
    await assertDirectory(fs, target, label),
    stateSecurity,
    label,
    stateSecurity.directoryMode,
  );
}

async function writePrivateFile(fs, target, contents, stateSecurity, replace = false) {
  await fs.writeAtomic({
    directory: path.dirname(target),
    filename: path.basename(target),
    contents,
    mode: stateSecurity.fileMode,
    uid: stateSecurity.uid,
    gid: stateSecurity.gid,
    replace,
  });
  assertExpectedMetadata(
    await assertRegularFile(fs, target, 'private transaction file'),
    stateSecurity,
    'private transaction file',
    stateSecurity.fileMode,
  );
}

async function assertRemoteAbsent(executor, target) {
  const lstat = await executor.lstat(target);
  if (!lstat || lstat.exists !== false) fail('remote lstat did not prove the target is absent');
  if (await executor.testAbsent(target) !== true) fail('remote test ! -e did not prove the target is absent');
}

async function assertArtifactAbsent(fs, executor, artifactPath) {
  if (await lstatOrNull(fs, artifactPath)) fail('artifact destination already exists');
  await assertRemoteAbsent(executor, artifactPath);
}

function assertPrepared(prepared) {
  if (!isPlainObject(prepared) || prepared.schemaVersion !== 1) {
    fail('prepared gallery update has an unsupported schema');
  }
  const metadata = validateMetadata(prepared.metadata);
  const candidateBytes = toBuffer(prepared.candidateBytes, 'prepared candidateBytes');
  for (const field of ['previousIndexSha256', 'candidateIndexSha256']) {
    if (typeof prepared[field] !== 'string' || !SHA256.test(prepared[field])) {
      fail(`prepared gallery update has invalid ${field}`);
    }
  }
  if (sha256(candidateBytes) !== prepared.candidateIndexSha256) {
    fail('prepared candidate bytes do not match their recorded checksum');
  }
  if (typeof prepared.adapterFingerprint !== 'string' || prepared.adapterFingerprint.trim().length === 0) {
    fail('prepared gallery update has an invalid adapter fingerprint');
  }
  if (typeof prepared.adapterVersion !== 'string' || prepared.adapterVersion.trim().length === 0) {
    fail('prepared gallery update has an invalid adapter version');
  }
  if (!Array.isArray(prepared.declaredEditRanges) || !Array.isArray(prepared.previousEntries) || !Array.isArray(prepared.candidateEntries)) {
    fail('prepared gallery update has invalid adapter evidence');
  }
  return {
    ...prepared,
    metadata,
    candidateBytes,
    declaredEditRanges: canonicalJson(prepared.declaredEditRanges),
    previousEntries: canonicalJson(prepared.previousEntries),
    candidateEntries: canonicalJson(prepared.candidateEntries),
  };
}

function assertPreparedMatchesRegenerated(reviewed, regenerated) {
  const stringFields = ['adapterFingerprint', 'adapterVersion', 'previousIndexSha256', 'candidateIndexSha256'];
  for (const field of stringFields) {
    if (reviewed[field] !== regenerated[field]) fail(`publish refused because reviewed ${field} no longer matches`);
  }
  if (!reviewed.candidateBytes.equals(regenerated.candidateBytes)) {
    fail('publish refused because reviewed candidate bytes no longer match');
  }
  for (const field of ['declaredEditRanges', 'previousEntries', 'candidateEntries']) {
    if (!sameJson(reviewed[field], regenerated[field])) {
      fail(`publish refused because reviewed ${field} no longer matches`);
    }
  }
}

function assertAdapterIdentity(adapter, expectedFingerprint, expectedVersion, indexBytes) {
  if (adapter.version !== expectedVersion || adapter.fingerprint(Buffer.from(indexBytes)) !== expectedFingerprint) {
    fail('publish refused because the adapter identity has drifted');
  }
}

function serializablePrepared(prepared) {
  return {
    schemaVersion: prepared.schemaVersion,
    metadata: prepared.metadata,
    adapterFingerprint: prepared.adapterFingerprint,
    adapterVersion: prepared.adapterVersion,
    previousIndexSha256: prepared.previousIndexSha256,
    candidateIndexSha256: prepared.candidateIndexSha256,
    declaredEditRanges: prepared.declaredEditRanges,
    previousEntries: prepared.previousEntries,
    candidateEntries: prepared.candidateEntries,
    candidateBytesBase64: prepared.candidateBytes.toString('base64'),
  };
}

function deserializePrepared(value) {
  if (!isPlainObject(value) || typeof value.candidateBytesBase64 !== 'string') {
    fail('prepared file has an unsupported schema');
  }
  const { candidateBytesBase64, ...prepared } = value;
  return assertPrepared({ ...prepared, candidateBytes: Buffer.from(candidateBytesBase64, 'base64') });
}

async function writeJournal(fs, journalPath, journal, stateSecurity, now) {
  journal.updatedAt = nowIso(now);
  await writePrivateFile(fs, journalPath, `${JSON.stringify(journal, null, 2)}\n`, stateSecurity, true);
}

async function setPhase(fs, journalPath, journal, phase, stateSecurity, now, phaseHook) {
  journal.phase = phase;
  journal.phases[phase] = nowIso(now);
  await writeJournal(fs, journalPath, journal, stateSecurity, now);
  if (phaseHook) await phaseHook(phase, { ...journal });
}

async function readJournal(fs, journalPath, stateSecurity) {
  const stat = await assertRegularFile(fs, journalPath, 'transaction journal');
  assertExpectedMetadata(stat, stateSecurity, 'transaction journal', stateSecurity.fileMode);
  let journal;
  try {
    journal = JSON.parse((await fs.readFile(journalPath)).toString('utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) fail('transaction journal is not valid JSON');
    throw error;
  }
  if (!isPlainObject(journal) || journal.schemaVersion !== 2) fail('transaction journal has an unsupported schema');
  assertTransactionId(journal.transactionId);
  assertSafeSlug(journal.slug, 'transaction journal slug');
  for (const field of ['previousIndexSha256', 'candidateIndexSha256', 'artifactIndexSha256', 'artifactTreeSha256']) {
    if (typeof journal[field] !== 'string' || !SHA256.test(journal[field])) {
      fail(`transaction journal has invalid ${field}`);
    }
  }
  if (!isPlainObject(journal.previousIndexMetadata)) fail('transaction journal has no prior index metadata');
  assertAuditedIndexMetadata(journal.previousIndexMetadata, 'transaction journal prior');
  if (journal.candidateIndexMetadata === undefined) {
    // Transactions written before candidate metadata was recorded used the same
    // audited metadata for both indexes. Preserve that safe compatibility rule.
    journal.candidateIndexMetadata = { ...journal.previousIndexMetadata };
  }
  assertAuditedIndexMetadata(journal.candidateIndexMetadata, 'transaction journal candidate');
  if (journal.rollbackIndexExchange !== undefined) {
    const exchange = journal.rollbackIndexExchange;
    if (
      !isPlainObject(exchange)
      || !['exchanging', 'reversing', 'manual-reconciliation'].includes(exchange.status)
      || exchange.stagePath !== 'rollback-index.html'
    ) {
      fail('transaction journal has an unsafe rollback index exchange record');
    }
    if (exchange.displaced !== undefined) {
      const displaced = exchange.displaced;
      if (
        !isPlainObject(displaced)
        || !['index.html', 'rollback-index.html'].includes(displaced.path)
        || !['live', 'staged'].includes(displaced.location)
        || (displaced.sha256 !== null && (typeof displaced.sha256 !== 'string' || !SHA256.test(displaced.sha256)))
      ) {
        fail('transaction journal has an unsafe rollback displaced-index record');
      }
    }
  }
  if (!Array.isArray(journal.forbiddenStrings) || journal.forbiddenStrings.some(
    (value) => typeof value !== 'string' || value.length === 0,
  )) {
    fail('transaction journal has invalid authenticated fallback markers');
  }
  return journal;
}

async function preflight({ fs, galleryRoot, stateRoot, artifactDirectory, security, requiredBytes }) {
  const gallery = await canonicalDirectory(fs, galleryRoot, 'gallery root');
  const state = await canonicalDirectory(fs, stateRoot, 'state root');
  const artifact = artifactDirectory
    ? await canonicalDirectory(fs, artifactDirectory, 'artifact source root')
    : null;
  assertDisjointRoots(...[gallery.path, state.path, artifact?.path].filter(Boolean));
  assertExpectedMetadata(gallery.stat, security.web, 'gallery root', security.web.directoryMode);
  assertExpectedMetadata(state.stat, security.state, 'state root', security.state.directoryMode);
  if (gallery.stat.dev !== state.stat.dev) fail('gallery and state roots must use the same filesystem device');
  const gallerySpace = statfsFreeBytes(await fs.statfs(gallery.path));
  const stateSpace = statfsFreeBytes(await fs.statfs(state.path));
  if (gallerySpace < requiredBytes || stateSpace < requiredBytes || Math.min(gallerySpace, stateSpace) < security.minFreeBytes) {
    fail('insufficient free space for a durable publisher transaction');
  }
  const index = await readIndex(fs, gallery.path);
  const indexMetadata = assertExpectedMetadata(index.stat, security.web, 'gallery index', security.web.fileMode);
  return {
    galleryRoot: gallery.path,
    stateRoot: state.path,
    artifactDirectory: artifact?.path,
    index,
    indexMetadata,
  };
}

async function assertStageIndex(fs, target, prepared, indexMetadata) {
  const stat = await assertRegularFile(fs, target, 'staged candidate index');
  const observed = normalizeMetadata(stat);
  if (!sameJson(observed, indexMetadata)) fail('staged candidate index metadata does not match the prior index');
  if (sha256(await fs.readFile(target)) !== prepared.candidateIndexSha256) {
    fail('staged candidate index checksum mismatch');
  }
}

async function assertIndexPromotionPreconditions({
  fs,
  galleryRoot,
  stagedIndex,
  adapter,
  journal,
  security,
}) {
  const liveIndex = await readIndex(fs, galleryRoot);
  if (sha256(liveIndex.bytes) !== journal.previousIndexSha256) {
    fail('publish refused because the live index has drifted');
  }
  if (!sameJson(normalizeMetadata(liveIndex.stat), journal.previousIndexMetadata)) {
    fail('publish refused because live index ownership or mode has drifted');
  }
  assertAdapterIdentity(adapter, journal.adapterFingerprint, journal.adapterVersion, liveIndex.bytes);
  const artifactPath = childPath(galleryRoot, journal.slug);
  if (await artifactStateAt(fs, artifactPath, journal, security, 'promoted artifact') !== 'candidate') {
    fail('publish refused because the promoted artifact has drifted');
  }
  await assertStageIndex(fs, stagedIndex, { candidateIndexSha256: journal.candidateIndexSha256 }, journal.previousIndexMetadata);
}

async function exchangeCandidateIndex({ fs, galleryRoot, stagedIndex, journal }) {
  const liveIndex = childPath(galleryRoot, INDEX_NAME);
  await fs.renameExchange(stagedIndex, liveIndex);
  await fs.fsyncDirectory(galleryRoot);
  await fs.fsyncDirectory(path.dirname(stagedIndex));

  const displaced = await assertRegularFile(fs, stagedIndex, 'displaced gallery index');
  const displacedBytes = toBuffer(await fs.readFile(stagedIndex), 'displaced gallery index');
  if (
    sha256(displacedBytes) !== journal.previousIndexSha256
    || !sameJson(normalizeMetadata(displaced), journal.previousIndexMetadata)
  ) {
    await fs.renameExchange(stagedIndex, liveIndex);
    await fs.fsyncDirectory(galleryRoot);
    await fs.fsyncDirectory(path.dirname(stagedIndex));
    await fs.rm(stagedIndex, { force: false });
    await fs.fsyncDirectory(path.dirname(stagedIndex));
    fail('publish refused because final index promotion encountered external drift');
  }
  await fs.rm(stagedIndex, { force: false });
  await fs.fsyncDirectory(path.dirname(stagedIndex));
}

function quarantineRootPath(transactionRoot) {
  return childPath(transactionRoot, 'quarantine');
}

function quarantineArtifactPath(transactionRoot) {
  return childPath(quarantineRootPath(transactionRoot), 'artifact');
}

async function inspectLiveState(fs, galleryRoot, transactionRoot, journal, security) {
  let index;
  try {
    index = await readIndex(fs, galleryRoot);
  } catch (error) {
    if (error instanceof PublisherError) return { kind: 'drift', reason: error.message };
    throw error;
  }
  const indexHash = sha256(index.bytes);
  const indexState = indexHash === journal.previousIndexSha256
    ? 'previous'
    : indexHash === journal.candidateIndexSha256 ? 'candidate' : 'drift';
  const artifactPath = childPath(galleryRoot, journal.slug);
  const quarantinedArtifactPath = quarantineArtifactPath(transactionRoot);
  const promotedArtifactState = await artifactStateAt(
    fs,
    artifactPath,
    journal,
    security,
    'promoted artifact',
  );
  const quarantinedArtifactState = await artifactStateAt(
    fs,
    quarantinedArtifactPath,
    journal,
    security,
    'quarantined transaction artifact',
  );

  let artifactState = 'absent';
  if (promotedArtifactState !== 'absent' && quarantinedArtifactState !== 'absent') {
    artifactState = 'drift';
  } else if (promotedArtifactState === 'candidate') {
    artifactState = 'candidate';
  } else if (quarantinedArtifactState === 'candidate') {
    artifactState = 'quarantined';
  } else if (promotedArtifactState === 'drift' || quarantinedArtifactState === 'drift') {
    artifactState = 'drift';
  }

  return {
    indexState,
    artifactState,
    artifactPath,
    quarantinedArtifactPath,
  };
}

function rollbackIndexStagePath(transactionRoot) {
  return childPath(transactionRoot, 'rollback-index.html');
}

async function previousIndexSnapshot(fs, transactionRoot, journal, security) {
  const previousPath = childPath(transactionRoot, 'previous-index.html');
  const snapshotStat = await assertRegularFile(fs, previousPath, 'previous index snapshot');
  assertExpectedMetadata(snapshotStat, security.state, 'previous index snapshot', security.state.fileMode);
  const previous = toBuffer(await fs.readFile(previousPath), 'previous index snapshot');
  if (sha256(previous) !== journal.previousIndexSha256) fail('rollback refused because the previous index snapshot has drifted');
  return previous;
}

async function inspectRollbackIndexPath(fs, target, journal) {
  const stat = await lstatOrNull(fs, target);
  if (stat === null) return { state: 'absent', target, sha256: null, metadata: null };
  if (isSymlink(stat) || !isFile(stat)) return { state: 'unsafe', target, sha256: null, metadata: null };
  const bytes = toBuffer(await fs.readFile(target), 'rollback index exchange path');
  const metadata = normalizeMetadata(stat);
  const checksum = sha256(bytes);
  if (checksum === journal.previousIndexSha256 && sameJson(metadata, journal.previousIndexMetadata)) {
    return { state: 'previous', target, sha256: checksum, metadata };
  }
  if (checksum === journal.candidateIndexSha256 && sameJson(metadata, journal.candidateIndexMetadata)) {
    return { state: 'candidate', target, sha256: checksum, metadata };
  }
  return { state: 'external', target, sha256: checksum, metadata };
}

async function inspectRollbackIndexExchange(fs, galleryRoot, transactionRoot, journal) {
  const livePath = childPath(galleryRoot, INDEX_NAME);
  const stagePath = rollbackIndexStagePath(transactionRoot);
  return {
    live: await inspectRollbackIndexPath(fs, livePath, journal),
    staged: await inspectRollbackIndexPath(fs, stagePath, journal),
  };
}

function rollbackDisplacedRecord(observed) {
  if (observed.live.state === 'external' || observed.live.state === 'unsafe') {
    return {
      path: 'index.html',
      location: 'live',
      sha256: observed.live.sha256,
    };
  }
  return {
    path: 'rollback-index.html',
    location: 'staged',
    sha256: observed.staged.sha256,
  };
}

async function markRollbackIndexManualReconciliation({
  fs,
  journalPath,
  journal,
  security,
  now,
  phaseHook,
  observed,
}) {
  journal.rollbackIndexExchange = {
    status: 'manual-reconciliation',
    stagePath: 'rollback-index.html',
    displaced: rollbackDisplacedRecord(observed),
  };
  await setPhase(
    fs,
    journalPath,
    journal,
    'rollback-index-manual-reconciliation',
    security.state,
    now,
    phaseHook,
  );
}

async function stagePreviousIndexForRollback({ fs, transactionRoot, journal, security }) {
  const stagePath = rollbackIndexStagePath(transactionRoot);
  const existing = await lstatOrNull(fs, stagePath);
  if (existing !== null) return stagePath;
  const previous = await previousIndexSnapshot(fs, transactionRoot, journal, security);
  await fs.writeAtomic({
    directory: transactionRoot,
    filename: 'rollback-index.html',
    contents: previous,
    mode: journal.previousIndexMetadata.mode,
    uid: journal.previousIndexMetadata.uid,
    gid: journal.previousIndexMetadata.gid,
    replace: false,
  });
  const staged = await inspectRollbackIndexPath(fs, stagePath, journal);
  if (staged.state !== 'previous') {
    fail('rollback refused because the staged previous index does not match its recorded bytes and metadata');
  }
  return stagePath;
}

async function completeKnownRollbackIndexRestore({
  fs,
  galleryRoot,
  transactionRoot,
  journalPath,
  journal,
  security,
  now,
  phaseHook,
}) {
  await fs.fsyncDirectory(galleryRoot);
  await fs.fsyncDirectory(transactionRoot);
  await setPhase(fs, journalPath, journal, 'rollback-index-restored', security.state, now, phaseHook);
  const stagePath = rollbackIndexStagePath(transactionRoot);
  await fs.rm(stagePath, { force: false });
  await fs.fsyncDirectory(transactionRoot);
  delete journal.rollbackIndexExchange;
  await writeJournal(fs, journalPath, journal, security.state, now);
}

async function reverseRollbackIndexExchange({
  fs,
  galleryRoot,
  transactionRoot,
  journalPath,
  journal,
  security,
  now,
  phaseHook,
}) {
  const livePath = childPath(galleryRoot, INDEX_NAME);
  const stagePath = rollbackIndexStagePath(transactionRoot);
  const before = await inspectRollbackIndexExchange(fs, galleryRoot, transactionRoot, journal);
  if (before.live.state !== 'previous' || before.staged.state !== 'external') {
    await markRollbackIndexManualReconciliation({
      fs, journalPath, journal, security, now, phaseHook, observed: before,
    });
    fail('rollback index exchange requires manual reconciliation before external content can be classified');
  }
  journal.rollbackIndexExchange = {
    status: 'reversing',
    stagePath: 'rollback-index.html',
    displaced: rollbackDisplacedRecord(before),
  };
  await setPhase(fs, journalPath, journal, 'rollback-index-reversing', security.state, now, phaseHook);

  const revalidated = await inspectRollbackIndexExchange(fs, galleryRoot, transactionRoot, journal);
  if (revalidated.live.state !== 'previous' || revalidated.staged.state !== 'external') {
    await markRollbackIndexManualReconciliation({
      fs, journalPath, journal, security, now, phaseHook, observed: revalidated,
    });
    fail('rollback index exchange changed before external content could be restored');
  }

  try {
    await fs.renameExchange(stagePath, livePath);
    await fs.fsyncDirectory(galleryRoot);
    await fs.fsyncDirectory(transactionRoot);
  } catch (error) {
    const observed = await inspectRollbackIndexExchange(fs, galleryRoot, transactionRoot, journal);
    await markRollbackIndexManualReconciliation({
      fs, journalPath, journal, security, now, phaseHook, observed,
    });
    throw new PublisherError('rollback index exchange reversal requires manual reconciliation', { cause: error });
  }

  const observed = await inspectRollbackIndexExchange(fs, galleryRoot, transactionRoot, journal);
  await markRollbackIndexManualReconciliation({
    fs, journalPath, journal, security, now, phaseHook, observed,
  });
  fail('rollback refused because external index drift was restored and requires manual reconciliation');
}

async function resolveRollbackIndexExchange({
  fs,
  galleryRoot,
  transactionRoot,
  journalPath,
  journal,
  security,
  now,
  phaseHook,
  allowExternalRetry,
}) {
  const livePath = childPath(galleryRoot, INDEX_NAME);
  const stagePath = rollbackIndexStagePath(transactionRoot);
  let observed = await inspectRollbackIndexExchange(fs, galleryRoot, transactionRoot, journal);

  if (observed.live.state === 'candidate' && observed.staged.state === 'previous') {
    journal.rollbackIndexExchange = {
      status: 'exchanging',
      stagePath: 'rollback-index.html',
    };
    await setPhase(fs, journalPath, journal, 'rollback-index-exchanging', security.state, now, phaseHook);
    observed = await inspectRollbackIndexExchange(fs, galleryRoot, transactionRoot, journal);
    if (observed.live.state !== 'candidate' || observed.staged.state !== 'previous') {
      return resolveRollbackIndexExchange({
        fs, galleryRoot, transactionRoot, journalPath, journal, security, now, phaseHook, allowExternalRetry,
      });
    }
    await fs.renameExchange(stagePath, livePath);
    await fs.fsyncDirectory(galleryRoot);
    await fs.fsyncDirectory(transactionRoot);
    observed = await inspectRollbackIndexExchange(fs, galleryRoot, transactionRoot, journal);
  }

  if (observed.live.state === 'previous' && observed.staged.state === 'candidate') {
    await completeKnownRollbackIndexRestore({
      fs, galleryRoot, transactionRoot, journalPath, journal, security, now, phaseHook,
    });
    return { restored: true };
  }

  if (
    observed.live.state === 'previous'
    && observed.staged.state === 'absent'
    && journal.phase === 'rollback-index-restored'
  ) {
    delete journal.rollbackIndexExchange;
    await writeJournal(fs, journalPath, journal, security.state, now);
    return { restored: true };
  }

  if (observed.live.state === 'previous' && observed.staged.state === 'external' && allowExternalRetry) {
    return reverseRollbackIndexExchange({
      fs, galleryRoot, transactionRoot, journalPath, journal, security, now, phaseHook,
    });
  }

  await markRollbackIndexManualReconciliation({
    fs, journalPath, journal, security, now, phaseHook, observed,
  });
  fail('rollback index exchange requires manual reconciliation; unclassified external content was retained');
}

async function restorePreviousIndex({
  fs,
  galleryRoot,
  transactionRoot,
  journalPath,
  journal,
  security,
  now,
  phaseHook,
  allowExternalRetry,
}) {
  await stagePreviousIndexForRollback({ fs, transactionRoot, journal, security });
  return resolveRollbackIndexExchange({
    fs,
    galleryRoot,
    transactionRoot,
    journalPath,
    journal,
    security,
    now,
    phaseHook,
    allowExternalRetry,
  });
}

async function removeOnlyTransactionArtifact({
  fs,
  executor,
  galleryRoot,
  transactionRoot,
  journalPath,
  journal,
  security,
  now,
  phaseHook,
}) {
  const artifactPath = childPath(galleryRoot, journal.slug);
  const quarantineRoot = quarantineRootPath(transactionRoot);
  const quarantinedArtifactPath = quarantineArtifactPath(transactionRoot);
  const liveArtifactState = await artifactStateAt(fs, artifactPath, journal, security, 'transaction artifact');
  const quarantinedArtifactState = await artifactStateAt(
    fs,
    quarantinedArtifactPath,
    journal,
    security,
    'quarantined transaction artifact',
  );

  if (liveArtifactState === 'drift' || quarantinedArtifactState === 'drift') {
    fail('transaction artifact has drifted and cannot be deleted');
  }
  if (liveArtifactState === 'candidate' && quarantinedArtifactState !== 'absent') {
    fail('transaction artifact has an unexpected quarantine collision');
  }

  if (liveArtifactState === 'candidate') {
    await ensureStateDirectory(fs, quarantineRoot, security.state, 'transaction quarantine root');
    await setPhase(fs, journalPath, journal, 'artifact-quarantining', security.state, now, phaseHook);
    await fs.renameNoReplace(artifactPath, quarantinedArtifactPath);
    await fs.fsyncDirectory(galleryRoot);
    await fs.fsyncDirectory(quarantineRoot);
    await setPhase(fs, journalPath, journal, 'artifact-quarantined', security.state, now, phaseHook);
  } else if (liveArtifactState === 'absent' && quarantinedArtifactState === 'absent') {
    await assertRemoteAbsent(executor, artifactPath);
    return;
  } else if (liveArtifactState !== 'absent') {
    fail('transaction artifact is not eligible for quarantine');
  }

  await setPhase(fs, journalPath, journal, 'artifact-removing', security.state, now, phaseHook);
  if (await artifactStateAt(fs, quarantinedArtifactPath, journal, security, 'quarantined transaction artifact') !== 'candidate') {
    fail('quarantined transaction artifact has drifted and was retained for reconciliation');
  }
  await fs.rm(quarantinedArtifactPath, { recursive: true, force: false });
  await fs.fsyncDirectory(quarantineRoot);
  await assertRemoteAbsent(executor, artifactPath);
}

function normalizedForbiddenStrings(metadata, artifactBodyMarker) {
  const values = [metadata.title];
  if (artifactBodyMarker !== undefined && artifactBodyMarker !== null) {
    if (typeof artifactBodyMarker !== 'string' || artifactBodyMarker.length === 0) {
      fail('artifactBodyMarker must be a non-empty string when supplied');
    }
    values.push(artifactBodyMarker);
  }
  return values;
}

export function verifyFormerArtifactResponse(response, { artifactSha256, forbiddenStrings }) {
  if (!response || typeof response !== 'object') fail('authenticated verifier must return a response object');
  if (typeof artifactSha256 !== 'string' || !SHA256.test(artifactSha256)) {
    fail('authenticated verifier requires an artifact SHA-256 hash');
  }
  if (!Array.isArray(forbiddenStrings) || forbiddenStrings.some((value) => typeof value !== 'string' || value.length === 0)) {
    fail('authenticated verifier requires non-empty artifact-specific markers');
  }
  const body = typeof response.body === 'string'
    ? Buffer.from(response.body, 'utf8')
    : toBuffer(response.body, 'authenticated response body');
  if (sha256(body) === artifactSha256) fail('authenticated former-artifact response still matches the artifact checksum');
  for (const value of forbiddenStrings) {
    if (body.includes(Buffer.from(value))) fail('authenticated former-artifact response still contains artifact-specific content');
  }
  return { status: response.status ?? null, bodySha256: sha256(body) };
}

async function reconcileTransaction({
  fs,
  executor,
  galleryRoot,
  stateRoot,
  transactionRoot,
  journalPath,
  journal,
  security,
  now,
  authenticatedVerifier,
  rollback,
  phaseHook,
}) {
  await preflight({
    fs,
    galleryRoot,
    stateRoot,
    security,
    requiredBytes: security.minFreeBytes,
  });
  const candidatePath = childPath(transactionRoot, 'candidate-index.html');
  const candidateStat = await lstatOrNull(fs, candidatePath);
  if (candidateStat !== null) {
    if (isSymlink(candidateStat) || !isFile(candidateStat)) fail('candidate index snapshot must be a regular file');
    assertExpectedMetadata(candidateStat, security.state, 'candidate index snapshot', security.state.fileMode);
    if (sha256(await fs.readFile(candidatePath)) !== journal.candidateIndexSha256) {
      fail('rollback refused because the candidate index snapshot has drifted');
    }
  }
  const rollbackStage = await lstatOrNull(fs, rollbackIndexStagePath(transactionRoot));
  if (rollbackStage !== null || journal.rollbackIndexExchange !== undefined) {
    await resolveRollbackIndexExchange({
      fs,
      galleryRoot,
      transactionRoot,
      journalPath,
      journal,
      security,
      now,
      phaseHook,
      allowExternalRetry: rollback,
    });
  }
  const state = await inspectLiveState(fs, galleryRoot, transactionRoot, journal, security);
  if (candidateStat === null && (state.indexState !== 'previous' || state.artifactState !== 'absent')) {
    fail('recovery refused because the required candidate snapshot is missing');
  }
  if (!rollback && state.indexState === 'drift' && ['candidate', 'quarantined'].includes(state.artifactState)) {
    await setPhase(fs, journalPath, journal, 'recovery-artifact-removing-after-index-drift', security.state, now);
    await removeOnlyTransactionArtifact({
      fs,
      executor,
      galleryRoot,
      transactionRoot,
      journalPath,
      journal,
      security,
      now,
      phaseHook,
    });
    await setPhase(fs, journalPath, journal, 'failed-cleaned-external-drift', security.state, now);
    return { journal: { ...journal }, externalIndexDrift: true };
  }
  if (state.indexState === 'drift' || state.artifactState === 'drift') {
    fail('recovery refused because the live index or artifact has drifted');
  }

  if (state.indexState === 'candidate') {
    await setPhase(fs, journalPath, journal, 'recovery-index-restoring', security.state, now);
    await restorePreviousIndex({
      fs,
      galleryRoot,
      transactionRoot,
      journalPath,
      journal,
      security,
      now,
      phaseHook,
      allowExternalRetry: rollback,
    });
  }
  if (['candidate', 'quarantined'].includes(state.artifactState)) {
    await setPhase(fs, journalPath, journal, 'recovery-artifact-removing', security.state, now);
    await removeOnlyTransactionArtifact({
      fs,
      executor,
      galleryRoot,
      transactionRoot,
      journalPath,
      journal,
      security,
      now,
      phaseHook,
    });
  }

  const reconciled = await inspectLiveState(fs, galleryRoot, transactionRoot, journal, security);
  if (reconciled.indexState !== 'previous' || reconciled.artifactState !== 'absent') {
    fail('recovery could not prove the pre-publication state');
  }

  let verification;
  if (rollback) {
    if (typeof authenticatedVerifier !== 'function') fail('rollback requires an authenticated former-artifact verifier');
    await setPhase(fs, journalPath, journal, 'rollback-authenticating', security.state, now);
    verification = verifyFormerArtifactResponse(
      await authenticatedVerifier({ slug: journal.slug, artifactSha256: journal.artifactIndexSha256 }),
      { artifactSha256: journal.artifactIndexSha256, forbiddenStrings: journal.forbiddenStrings },
    );
  }
  await setPhase(fs, journalPath, journal, rollback ? 'rolled-back' : 'failed-recovered', security.state, now);
  return { journal: { ...journal }, verification };
}

async function leaseProcessStartTime(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  let stat;
  try {
    stat = await nodeReadFile(`/proc/${pid}/stat`, 'utf8');
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  const closingParenthesis = stat.lastIndexOf(')');
  if (closingParenthesis < 0) fail('publisher lease could not read a Linux process start time');
  const fields = stat.slice(closingParenthesis + 2).trim().split(/\s+/);
  const startTime = fields[19];
  if (!/^\d+$/.test(startTime ?? '')) fail('publisher lease received an invalid Linux process start time');
  return startTime;
}

async function leaseBootId() {
  const bootId = (await nodeReadFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(bootId)) {
    fail('publisher lease could not read the Linux boot identity');
  }
  return bootId.toLowerCase();
}

async function currentLeaseRecord(label) {
  const startTime = await leaseProcessStartTime(process.pid);
  if (startTime === null) fail('publisher lease could not identify the current process');
  return {
    schemaVersion: LEASE_SCHEMA_VERSION,
    pid: process.pid,
    bootId: await leaseBootId(),
    startTime,
    operation: label,
  };
}

function validateLeaseRecord(record) {
  if (
    !isPlainObject(record)
    || record.schemaVersion !== LEASE_SCHEMA_VERSION
    || !Number.isSafeInteger(record.pid)
    || record.pid < 1
    || typeof record.bootId !== 'string'
    || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(record.bootId)
    || typeof record.startTime !== 'string'
    || !/^\d+$/.test(record.startTime)
    || typeof record.operation !== 'string'
    || record.operation.length === 0
  ) {
    fail('publisher lease has an invalid ownership record');
  }
  return record;
}

async function readLeaseRecord(fs, target, stateSecurity) {
  const stat = await assertRegularFile(fs, target, 'publisher lease');
  assertExpectedMetadata(stat, stateSecurity, 'publisher lease', stateSecurity.fileMode);
  let record;
  try {
    record = JSON.parse((await fs.readFile(target)).toString('utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) fail('publisher lease has invalid JSON');
    throw error;
  }
  return validateLeaseRecord(record);
}

async function leaseIsActive(record) {
  if (record.bootId !== await leaseBootId()) return false;
  return await leaseProcessStartTime(record.pid) === record.startTime;
}

async function emitLeasePhase(leasePhaseHook, phase) {
  if (leasePhaseHook) await leasePhaseHook(phase);
}

async function createLease(fs, locksRoot, target, record, stateSecurity, leasePhaseHook) {
  let temporary;
  for (let attempt = 0; attempt < TEMP_ATTEMPTS; attempt += 1) {
    const candidate = childPath(locksRoot, `.publisher.lease-${randomUUID()}.tmp`);
    try {
      await fs.writeLeaseTemp({
        target: candidate,
        contents: `${JSON.stringify(record)}\n`,
        mode: stateSecurity.fileMode,
        uid: stateSecurity.uid,
        gid: stateSecurity.gid,
        phaseHook: leasePhaseHook,
      });
      temporary = candidate;
      break;
    } catch (error) {
      if (error?.code === 'EEXIST') continue;
      const staged = await lstatOrNull(fs, candidate);
      if (staged !== null) await fs.rm(candidate, { force: false });
      throw error;
    }
  }
  if (!temporary) fail('could not allocate a unique publisher lease temporary file');

  try {
    const staged = await readLeaseRecord(fs, temporary, stateSecurity);
    if (!sameJson(staged, record)) fail('publisher lease temporary changed before installation');
    await emitLeasePhase(leasePhaseHook, 'lease-before-rename');
    await fs.renameNoReplace(temporary, target);
    await emitLeasePhase(leasePhaseHook, 'lease-after-rename');
    await emitLeasePhase(leasePhaseHook, 'lease-before-directory-fsync');
    await fs.fsyncDirectory(locksRoot);
    await emitLeasePhase(leasePhaseHook, 'lease-after-directory-fsync');
    const installed = await readLeaseRecord(fs, target, stateSecurity);
    if (!sameJson(installed, record)) fail('publisher lease changed during installation');
  } catch (error) {
    const staged = await lstatOrNull(fs, temporary);
    if (staged !== null) await fs.rm(temporary, { force: false });
    throw error;
  }
}

async function reclaimStaleLease(fs, locksRoot, lockPath, record, stateSecurity) {
  const reclaimedPath = childPath(locksRoot, `.publisher.stale-${randomUUID()}`);
  try {
    await fs.renameNoReplace(lockPath, reclaimedPath);
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
  await fs.fsyncDirectory(locksRoot);
  const movedRecord = await readLeaseRecord(fs, reclaimedPath, stateSecurity);
  if (!sameJson(movedRecord, record)) {
    try {
      await fs.renameNoReplace(reclaimedPath, lockPath);
      await fs.fsyncDirectory(locksRoot);
    } catch (restoreError) {
      throw new PublisherError('publisher lease changed during stale takeover and could not be restored', { cause: restoreError });
    }
    fail('publisher lease changed during safe stale takeover');
  }
  await fs.rm(reclaimedPath, { force: false });
  await fs.fsyncDirectory(locksRoot);
  return true;
}

async function releaseLease(fs, lockPath, record, stateSecurity) {
  const current = await readLeaseRecord(fs, lockPath, stateSecurity);
  if (!sameJson(current, record)) fail('publisher lease ownership changed before release');
  await fs.rm(lockPath, { force: false });
  await fs.fsyncDirectory(path.dirname(lockPath));
}

async function withLock(fs, stateRoot, stateSecurity, label, callback, leasePhaseHook) {
  const locksRoot = childPath(stateRoot, 'locks');
  await ensureStateDirectory(fs, locksRoot, stateSecurity, 'lock state root');
  const lockPath = childPath(locksRoot, 'publisher.lock');
  const record = await currentLeaseRecord(label);
  let acquired = false;

  for (let attempt = 0; attempt < 8 && !acquired; attempt += 1) {
    try {
      await createLease(fs, locksRoot, lockPath, record, stateSecurity, leasePhaseHook);
      acquired = true;
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        try {
          const installed = await readLeaseRecord(fs, lockPath, stateSecurity);
          if (sameJson(installed, record)) await releaseLease(fs, lockPath, record, stateSecurity);
        } catch (releaseError) {
          if (!isNotFound(releaseError)) throw releaseError;
        }
        throw error;
      }
    }

    let incumbent;
    try {
      incumbent = await readLeaseRecord(fs, lockPath, stateSecurity);
    } catch (error) {
      if (isNotFound(error)) continue;
      throw error;
    }
    if (await leaseIsActive(incumbent)) fail('publisher lease is already held by a live process');
    if (!await reclaimStaleLease(fs, locksRoot, lockPath, incumbent, stateSecurity)) continue;
  }
  if (!acquired) fail('publisher lease could not be acquired after safe stale takeover');

  try {
    return await callback();
  } finally {
    await releaseLease(fs, lockPath, record, stateSecurity);
  }
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
  security,
  fs = createNodeFilesystem(),
  executor = createLocalExecutor(fs),
  now = () => new Date(),
  phaseHook,
  leasePhaseHook,
}) {
  const reviewed = assertPrepared(prepared);
  const validAdapter = assertAdapterContract(adapter);
  const validFs = assertFilesystem(fs);
  const validExecutor = assertExecutor(executor);
  const validSecurity = normalizeSecurity(security);
  const validTransactionId = assertTransactionId(transactionId);
  if (typeof postPublishVerifier !== 'function') fail('publish requires a postPublishVerifier');
  if (typeof authenticatedVerifier !== 'function') fail('publish requires an authenticated rollback verifier');
  if (phaseHook !== undefined && typeof phaseHook !== 'function') fail('phaseHook must be a function when supplied');
  if (leasePhaseHook !== undefined && typeof leasePhaseHook !== 'function') fail('leasePhaseHook must be a function when supplied');

  const sourceTree = await checksumTree(validFs, artifactDirectory);
  if (await checksumArtifactIndex(validFs, artifactDirectory, 'artifact source') !== reviewed.metadata.artifactSha256) {
    fail('artifact source index does not match metadata.artifactSha256');
  }
  const requiredBytes = Math.max(
    validSecurity.minFreeBytes,
    sourceTree.bytes * 2 + reviewed.candidateBytes.length * 3 + 65_536,
  );
  const initial = await preflight({
    fs: validFs,
    galleryRoot,
    stateRoot,
    artifactDirectory,
    security: validSecurity,
    requiredBytes,
  });
  const transactionRoot = childPath(initial.stateRoot, 'transactions', validTransactionId);
  const stagingRoot = childPath(initial.stateRoot, 'staging', validTransactionId);
  const journalPath = childPath(transactionRoot, 'transaction.json');

  return withLock(validFs, initial.stateRoot, validSecurity.state, validTransactionId, async () => {
    const current = await preflight({
      fs: validFs,
      galleryRoot: initial.galleryRoot,
      stateRoot: initial.stateRoot,
      artifactDirectory: initial.artifactDirectory,
      security: validSecurity,
      requiredBytes,
    });
    const regenerated = prepareGalleryIndex({
      indexBytes: current.index.bytes,
      metadata: reviewed.metadata,
      adapter: validAdapter,
    });
    assertPreparedMatchesRegenerated(reviewed, regenerated);

    const transactionsRoot = childPath(current.stateRoot, 'transactions');
    const stagingParent = childPath(current.stateRoot, 'staging');
    await ensureStateDirectory(validFs, transactionsRoot, validSecurity.state, 'transaction state root');
    await ensureStateDirectory(validFs, stagingParent, validSecurity.state, 'staging state root');
    if (await lstatOrNull(validFs, transactionRoot)) fail('transactionId already has a transaction journal');
    if (await lstatOrNull(validFs, stagingRoot)) fail('transaction staging path already exists');

    const artifactPath = childPath(current.galleryRoot, reviewed.metadata.slug);
    await assertArtifactAbsent(validFs, validExecutor, artifactPath);
    const journal = {
      schemaVersion: 2,
      transactionId: validTransactionId,
      slug: reviewed.metadata.slug,
      phase: 'prepared',
      phases: { prepared: nowIso(now) },
      createdAt: nowIso(now),
      updatedAt: nowIso(now),
      previousIndexSha256: regenerated.previousIndexSha256,
      candidateIndexSha256: regenerated.candidateIndexSha256,
      previousIndexMetadata: current.indexMetadata,
      candidateIndexMetadata: current.indexMetadata,
      artifactIndexSha256: reviewed.metadata.artifactSha256,
      artifactTreeSha256: sourceTree.sha256,
      adapterFingerprint: regenerated.adapterFingerprint,
      adapterVersion: regenerated.adapterVersion,
      declaredEditRanges: regenerated.declaredEditRanges,
      forbiddenStrings: normalizedForbiddenStrings(reviewed.metadata, artifactBodyMarker),
    };

    await makeStateDirectory(validFs, transactionRoot, validSecurity.state);
    await writeJournal(validFs, journalPath, journal, validSecurity.state, now);
    try {
      await setPhase(validFs, journalPath, journal, 'staging', validSecurity.state, now, phaseHook);
      await makeStateDirectory(validFs, stagingRoot, validSecurity.state);
      const stagedArtifact = childPath(stagingRoot, reviewed.metadata.slug);
      await copyTree(validFs, current.artifactDirectory, stagedArtifact, validSecurity.web);
      await assertTreeMetadata(validFs, stagedArtifact, validSecurity.web, 'staged artifact');
      if ((await checksumTree(validFs, stagedArtifact)).sha256 !== sourceTree.sha256) fail('staged artifact checksum mismatch');
      if (await checksumArtifactIndex(validFs, stagedArtifact, 'staged artifact') !== journal.artifactIndexSha256) {
        fail('staged artifact index checksum mismatch');
      }
      const stagedIndex = childPath(stagingRoot, 'candidate-index.html');
      await validFs.writeAtomic({
        directory: stagingRoot,
        filename: 'candidate-index.html',
        contents: regenerated.candidateBytes,
        mode: current.indexMetadata.mode,
        uid: current.indexMetadata.uid,
        gid: current.indexMetadata.gid,
        replace: false,
      });
      await assertStageIndex(validFs, stagedIndex, regenerated, current.indexMetadata);
      await setPhase(validFs, journalPath, journal, 'staged', validSecurity.state, now, phaseHook);

      await setPhase(validFs, journalPath, journal, 'snapshotting', validSecurity.state, now, phaseHook);
      await writePrivateFile(validFs, childPath(transactionRoot, 'previous-index.html'), current.index.bytes, validSecurity.state);
      await writePrivateFile(validFs, childPath(transactionRoot, 'candidate-index.html'), regenerated.candidateBytes, validSecurity.state);
      if (sha256(await validFs.readFile(childPath(transactionRoot, 'previous-index.html'))) !== journal.previousIndexSha256) {
        fail('previous index snapshot checksum mismatch');
      }
      await setPhase(validFs, journalPath, journal, 'snapshotted', validSecurity.state, now, phaseHook);

      const beforeArtifact = await readIndex(validFs, current.galleryRoot);
      if (sha256(beforeArtifact.bytes) !== journal.previousIndexSha256) fail('publish refused because the live index has drifted');
      assertAdapterIdentity(validAdapter, journal.adapterFingerprint, journal.adapterVersion, beforeArtifact.bytes);
      await assertArtifactAbsent(validFs, validExecutor, artifactPath);
      if ((await checksumTree(validFs, stagedArtifact)).sha256 !== journal.artifactTreeSha256) {
        fail('publish refused because the staged artifact has drifted');
      }
      await setPhase(validFs, journalPath, journal, 'artifact-promoting', validSecurity.state, now, phaseHook);
      await validFs.renameNoReplace(stagedArtifact, artifactPath);
      await validFs.fsyncDirectory(current.galleryRoot);
      await assertTreeMetadata(validFs, artifactPath, validSecurity.web, 'promoted artifact');
      if ((await checksumTree(validFs, artifactPath)).sha256 !== journal.artifactTreeSha256) {
        fail('promoted artifact checksum mismatch');
      }
      if (await checksumArtifactIndex(validFs, artifactPath, 'promoted artifact') !== journal.artifactIndexSha256) {
        fail('promoted artifact index checksum mismatch');
      }
      await setPhase(validFs, journalPath, journal, 'artifact-promoted', validSecurity.state, now, phaseHook);

      await assertIndexPromotionPreconditions({
        fs: validFs,
        galleryRoot: current.galleryRoot,
        stagedIndex,
        adapter: validAdapter,
        journal,
        security: validSecurity,
      });
      await setPhase(validFs, journalPath, journal, 'index-promoting', validSecurity.state, now, phaseHook);
      await assertIndexPromotionPreconditions({
        fs: validFs,
        galleryRoot: current.galleryRoot,
        stagedIndex,
        adapter: validAdapter,
        journal,
        security: validSecurity,
      });
      await exchangeCandidateIndex({
        fs: validFs,
        galleryRoot: current.galleryRoot,
        stagedIndex,
        journal,
      });
      const promotedIndex = await readIndex(validFs, current.galleryRoot);
      if (sha256(promotedIndex.bytes) !== journal.candidateIndexSha256) fail('candidate index promotion checksum mismatch');
      if (!sameJson(normalizeMetadata(promotedIndex.stat), journal.previousIndexMetadata)) {
        fail('promoted index ownership or mode differs from the audited prior index');
      }
      await setPhase(validFs, journalPath, journal, 'index-promoted', validSecurity.state, now, phaseHook);

      await setPhase(validFs, journalPath, journal, 'verifying', validSecurity.state, now, phaseHook);
      await postPublishVerifier({
        transactionId: validTransactionId,
        slug: journal.slug,
        artifactIndexSha256: journal.artifactIndexSha256,
        candidateIndexSha256: journal.candidateIndexSha256,
      });
      await setPhase(validFs, journalPath, journal, 'published', validSecurity.state, now, phaseHook);
      return { transactionId: validTransactionId, transactionRoot, journal: { ...journal }, prepared: serializablePrepared(regenerated) };
    } catch (error) {
      let recoveryError;
      try {
        const durableJournal = await readJournal(validFs, journalPath, validSecurity.state);
        await reconcileTransaction({
          fs: validFs,
          executor: validExecutor,
          galleryRoot: current.galleryRoot,
          stateRoot: current.stateRoot,
          transactionRoot,
          journalPath,
          journal: durableJournal,
          security: validSecurity,
          now,
          authenticatedVerifier,
          rollback: false,
          phaseHook: undefined,
        });
      } catch (recoveryFailure) {
        recoveryError = recoveryFailure;
      }
      if (recoveryError) {
        throw new PublisherError('publication failed and durable recovery could not be verified', { cause: recoveryError });
      }
      throw error;
    }
  }, leasePhaseHook);
}

export async function rollback({
  galleryRoot,
  stateRoot,
  transactionId,
  authenticatedVerifier,
  security,
  fs = createNodeFilesystem(),
  executor = createLocalExecutor(fs),
  now = () => new Date(),
  phaseHook,
  leasePhaseHook,
}) {
  const validFs = assertFilesystem(fs);
  const validExecutor = assertExecutor(executor);
  const validSecurity = normalizeSecurity(security);
  const validTransactionId = assertTransactionId(transactionId);
  if (typeof authenticatedVerifier !== 'function') fail('rollback requires an authenticated former-artifact verifier');
  if (phaseHook !== undefined && typeof phaseHook !== 'function') fail('phaseHook must be a function when supplied');
  if (leasePhaseHook !== undefined && typeof leasePhaseHook !== 'function') fail('leasePhaseHook must be a function when supplied');
  const initial = await preflight({
    fs: validFs,
    galleryRoot,
    stateRoot,
    security: validSecurity,
    requiredBytes: validSecurity.minFreeBytes,
  });
  const transactionRoot = childPath(initial.stateRoot, 'transactions', validTransactionId);
  const journalPath = childPath(transactionRoot, 'transaction.json');
  await assertDirectory(validFs, transactionRoot, 'transaction directory');
  return withLock(validFs, initial.stateRoot, validSecurity.state, `rollback-${validTransactionId}`, async () => {
    const journal = await readJournal(validFs, journalPath, validSecurity.state);
    if (journal.transactionId !== validTransactionId) fail('transaction journal ID does not match its path');
    return reconcileTransaction({
      fs: validFs,
      executor: validExecutor,
      galleryRoot: initial.galleryRoot,
      stateRoot: initial.stateRoot,
      transactionRoot,
      journalPath,
      journal,
      security: validSecurity,
      now,
      authenticatedVerifier,
      rollback: true,
      phaseHook,
    });
  }, leasePhaseHook);
}

const RENAMEAT2 = String.raw`
import ctypes
import os
import platform
import sys

numbers = {'x86_64': 316, 'aarch64': 276, 'arm64': 276}
number = numbers.get(platform.machine().lower())
if number is None:
    raise SystemExit('unsupported architecture for renameat2')
libc = ctypes.CDLL(None, use_errno=True)
result = libc.syscall(number, -100, os.fsencode(sys.argv[1]), -100, os.fsencode(sys.argv[2]), int(sys.argv[3]))
if result != 0:
    error = ctypes.get_errno()
    sys.stderr.write(f'renameat2-errno:{error}\n')
    raise SystemExit(1)
`;

function errnoCode(errno) {
  return Object.entries(osConstants.errno).find(([, value]) => value === errno)?.[0] ?? 'ERENAMEAT2';
}

async function renameAt2(source, destination, flags) {
  try {
    await executeFile('python3', ['-c', RENAMEAT2, source, destination, String(flags)], { maxBuffer: 1024 });
  } catch (error) {
    const match = /^renameat2-errno:(\d+)\s*$/.exec(error?.stderr ?? '');
    if (match) {
      const errno = Number(match[1]);
      const code = errnoCode(errno);
      if (code === 'EEXIST') {
        const exists = new Error('atomic no-replace destination already exists');
        exists.code = 'EEXIST';
        throw exists;
      }
      const failure = new Error(`atomic rename failed: ${code}`);
      failure.code = code;
      failure.errno = -errno;
      throw failure;
    }
    if (error?.code === 'EEXIST') {
      const exists = new Error('atomic no-replace destination already exists');
      exists.code = 'EEXIST';
      throw exists;
    }
    throw error;
  }
}

export function createNodeFilesystem({ randomId = randomUUID } = {}) {
  async function fsyncDirectory(directory) {
    const handle = await nodeOpen(directory, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async function writeAtomic({ directory, filename, contents, mode, uid, gid, replace }) {
    assertFilename(filename);
    const target = childPath(directory, filename);
    if (replace) {
      const existing = await lstatOrNull(api, target);
      if (existing !== null && (isSymlink(existing) || !isFile(existing))) {
        fail('atomic replacement target must be an existing regular file');
      }
    } else if (await lstatOrNull(api, target)) {
      fail('atomic no-replace target already exists');
    }

    for (let attempt = 0; attempt < TEMP_ATTEMPTS; attempt += 1) {
      const temporary = childPath(directory, `.${filename}.${randomId()}.tmp`);
      let handle;
      try {
        handle = await nodeOpen(
          temporary,
          fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
          mode,
        );
      } catch (error) {
        if (error?.code === 'EEXIST') continue;
        throw error;
      }
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) fail('atomic temporary path is not a regular file');
        await handle.writeFile(contents);
        await nodeChown(temporary, uid, gid);
        await nodeChmod(temporary, mode);
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (replace) await nodeRename(temporary, target);
      else await api.renameNoReplace(temporary, target);
      await fsyncDirectory(directory);
      return target;
    }
    fail('could not allocate a unique no-follow temporary file');
  }

  const api = {
    chmod: nodeChmod,
    chown: nodeChown,
    fsyncDirectory,
    lstat: nodeLstat,
    mkdir: nodeMkdir,
    readFile: nodeReadFile,
    readdir: nodeReaddir,
    realpath: nodeRealpath,
    renameReplace: nodeRename,
    renameExchange(source, destination) {
      return renameAt2(source, destination, 2);
    },
    renameNoReplace(source, destination) {
      return renameAt2(source, destination, 1);
    },
    rm: nodeRm,
    statfs: nodeStatfs,
    writeAtomic,
    async writeLeaseTemp({ target, contents, mode, uid, gid, phaseHook }) {
      const handle = await nodeOpen(
        target,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
        mode,
      );
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) fail('exclusive lock path is not a regular file');
        await emitLeasePhase(phaseHook, 'lease-temp-before-write');
        await handle.writeFile(contents);
        await emitLeasePhase(phaseHook, 'lease-temp-after-write');
        await nodeChown(target, uid, gid);
        await nodeChmod(target, mode);
        await emitLeasePhase(phaseHook, 'lease-temp-before-fsync');
        await handle.sync();
        await emitLeasePhase(phaseHook, 'lease-temp-after-fsync');
      } finally {
        await handle.close();
      }
    },
  };
  return api;
}

export function createLocalExecutor(fs = createNodeFilesystem()) {
  return {
    async lstat(target) {
      return { exists: (await lstatOrNull(fs, target)) !== null };
    },
    async testAbsent(target) {
      return (await lstatOrNull(fs, target)) === null;
    },
  };
}

function assertSshValue(value, label, expression) {
  if (typeof value !== 'string' || !expression.test(value)) fail(`SSH ${label} is invalid`);
  return value;
}

function assertSshRemotePath(remotePath) {
  if (
    typeof remotePath !== 'string'
    || !path.posix.isAbsolute(remotePath)
    || remotePath === '/'
    || remotePath !== path.posix.normalize(remotePath)
    || !/^\/[A-Za-z0-9._/-]+$/.test(remotePath)
  ) {
    fail('SSH remote path must be a normalized absolute path with safe characters');
  }
  return remotePath;
}

function assertCliKeyFileSyntax(keyFile) {
  if (
    typeof keyFile !== 'string'
    || !path.isAbsolute(keyFile)
    || keyFile !== path.normalize(keyFile)
    || keyFile.includes('\0')
    || /[\r\n]/.test(keyFile)
    || /-----BEGIN(?: [A-Z0-9 ]+)? KEY-----/i.test(keyFile)
  ) {
    fail('--key-file must be an absolute normalized key-file path, never key material');
  }
  return keyFile;
}

async function assertNativeKeyPathComponents(keyFile) {
  const parsed = path.parse(keyFile);
  let cursor = parsed.root;
  const components = keyFile.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (let index = 0; index < components.length; index += 1) {
    cursor = path.join(cursor, components[index]);
    let stat;
    try {
      stat = await nodeLstat(cursor);
    } catch (error) {
      if (isNotFound(error)) fail('--key-file must name an existing local regular file');
      throw error;
    }
    if (isSymlink(stat)) {
      if (index === components.length - 1) fail('--key-file must name a local non-symlink regular file');
      fail('--key-file must not have symbolic-link ancestor components');
    }
  }
}

function assertSecureCliKeyStat(stat) {
  if (!isFile(stat)) fail('--key-file must name a local non-symlink regular file');
  if (
    modeOf(stat) !== 0o600
    || stat.uid !== process.getuid()
    || stat.gid !== process.getgid()
  ) {
    fail('--key-file must have strict 0600 permissions and current-user ownership');
  }
}

async function fsyncNativeDirectory(directory) {
  const handle = await nodeOpen(directory, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function stageCliKeyFile(keyFile) {
  const absolute = assertCliKeyFileSyntax(keyFile);
  await assertNativeKeyPathComponents(absolute);
  let canonical;
  try {
    canonical = await nodeRealpath(absolute);
  } catch (error) {
    if (isNotFound(error)) fail('--key-file must name an existing local regular file');
    throw error;
  }
  if (canonical !== absolute) fail('--key-file must be a canonical local key-file path');

  const observed = await nodeLstat(absolute);
  assertSecureCliKeyStat(observed);
  let source;
  let keyDirectory;
  try {
    try {
      source = await nodeOpen(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    } catch (error) {
      if (error?.code === 'ELOOP') fail('--key-file changed before secure open');
      throw error;
    }
    const stable = await source.stat();
    assertSecureCliKeyStat(stable);
    if (stable.dev !== observed.dev || stable.ino !== observed.ino) {
      fail('--key-file changed between validation and secure open');
    }

    keyDirectory = await nodeMkdtemp(path.join(tmpdir(), 'heydex-publisher-key-'));
    await nodeChown(keyDirectory, process.getuid(), process.getgid());
    await nodeChmod(keyDirectory, 0o700);
    const stagedPath = path.join(keyDirectory, 'key');
    const destination = await nodeOpen(
      stagedPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
    try {
      await destination.writeFile(await source.readFile());
      await nodeChown(stagedPath, process.getuid(), process.getgid());
      await nodeChmod(stagedPath, 0o600);
      await destination.sync();
    } finally {
      await destination.close();
    }
    await fsyncNativeDirectory(keyDirectory);
    const staged = await nodeLstat(stagedPath);
    assertSecureCliKeyStat(staged);
    return {
      keyFile: stagedPath,
      async cleanup() {
        await nodeRm(keyDirectory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (keyDirectory) await nodeRm(keyDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    if (source) await source.close();
  }
}

export function createSshExecutor({ keyFile, host, user, run }) {
  if (
    typeof keyFile !== 'string'
    || !path.isAbsolute(keyFile)
    || keyFile !== path.normalize(keyFile)
    || keyFile.includes('\0')
    || /[\r\n]/.test(keyFile)
    || /-----BEGIN(?: [A-Z0-9 ]+)? KEY-----/i.test(keyFile)
  ) {
    fail('SSH keyFile must be an absolute key-file path');
  }
  const safeHost = assertSshValue(host, 'host', /^[A-Za-z0-9.-]+$/);
  const safeUser = assertSshValue(user, 'user', /^[A-Za-z_][A-Za-z0-9_-]*$/);
  if (typeof run !== 'function') fail('SSH executor requires an injected command runner');

  async function invoke(operation, remotePath) {
    if (typeof operation !== 'string' || !/^[a-z-]+$/.test(operation)) fail('SSH operation is invalid');
    const safeRemotePath = assertSshRemotePath(remotePath);
    return run('ssh', [
      '-i', keyFile,
      '-o', 'IdentitiesOnly=yes',
      '-o', 'BatchMode=yes',
      '--', `${safeUser}@${safeHost}`,
      'heydex-explainer-publisher', operation, safeRemotePath,
    ]);
  }

  return {
    async lstat(remotePath) {
      return invoke('lstat', remotePath);
    },
    async testAbsent(remotePath) {
      return invoke('test-absent', remotePath);
    },
  };
}

async function loadAdapter(adapterPath) {
  if (typeof adapterPath !== 'string' || !path.isAbsolute(adapterPath)) fail('--adapter must be an absolute module path');
  const module = await import(pathToFileURL(adapterPath).href);
  return module.default ?? module.adapter ?? module;
}

async function loadPublisherSeams(executorModulePath, context) {
  if (typeof executorModulePath !== 'string' || !path.isAbsolute(executorModulePath)) {
    fail('--executor-module must be an absolute reviewed module path');
  }
  const module = await import(pathToFileURL(executorModulePath).href);
  const factory = module.createPublisherSeams ?? module.default;
  if (typeof factory !== 'function') fail('reviewed executor module must export createPublisherSeams');
  const seams = await factory(context);
  if (!isPlainObject(seams)) fail('reviewed executor module returned invalid seams');
  assertFilesystem(seams.fs);
  assertExecutor(seams.executor);
  if (typeof seams.postPublishVerifier !== 'function' || typeof seams.authenticatedVerifier !== 'function') {
    fail('reviewed executor module must provide both verification functions');
  }
  return seams;
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined || options[key] !== undefined) fail('CLI options must be unique --name value pairs');
    options[key] = value;
  }
  return options;
}

export async function runCli(argv, {
  fs = createNodeFilesystem(),
  stdout = process.stdout,
  beforeExecutorModuleLoad,
} = {}) {
  const [command, ...rest] = argv;
  const options = parseOptions(rest);
  if (command === 'prepare') {
    for (const flag of ['--index', '--metadata', '--adapter', '--output']) if (!options[flag]) fail(`prepare requires ${flag}`);
    const prepared = prepare({
      indexBytes: await fs.readFile(options['--index']),
      metadata: JSON.parse((await fs.readFile(options['--metadata'])).toString('utf8')),
      adapter: await loadAdapter(options['--adapter']),
    });
    await fs.writeAtomic({
      directory: path.dirname(options['--output']),
      filename: path.basename(options['--output']),
      contents: `${JSON.stringify(serializablePrepared(prepared), null, 2)}\n`,
      mode: 0o600,
      uid: process.getuid(),
      gid: process.getgid(),
      replace: true,
    });
    stdout.write(`${options['--output']}\n`);
    return prepared;
  }
  if (command === 'publish' || command === 'rollback') {
    if (!options['--key-file']) fail(`${command} requires --key-file, never key material`);
    for (const flag of ['--gallery-root', '--state-root', '--transaction', '--security', '--executor-module']) {
      if (!options[flag]) fail(`${command} requires ${flag}`);
    }
    if (beforeExecutorModuleLoad !== undefined && typeof beforeExecutorModuleLoad !== 'function') {
      fail('beforeExecutorModuleLoad must be a function when supplied');
    }
    const stagedKey = await stageCliKeyFile(options['--key-file']);
    try {
      if (beforeExecutorModuleLoad) {
        await beforeExecutorModuleLoad({
          sourceKeyFile: options['--key-file'],
          executorKeyFile: stagedKey.keyFile,
        });
      }
      const security = JSON.parse((await fs.readFile(options['--security'])).toString('utf8'));
      const seams = await loadPublisherSeams(options['--executor-module'], {
        keyFile: stagedKey.keyFile,
        host: options['--ssh-host'],
        user: options['--ssh-user'],
      });
      if (command === 'rollback') {
        return await rollback({
          galleryRoot: options['--gallery-root'],
          stateRoot: options['--state-root'],
          transactionId: options['--transaction'],
          security,
          fs: seams.fs,
          executor: seams.executor,
          authenticatedVerifier: seams.authenticatedVerifier,
        });
      }
      for (const flag of ['--prepared', '--adapter', '--artifact-dir']) if (!options[flag]) fail(`publish requires ${flag}`);
      const prepared = deserializePrepared(JSON.parse((await fs.readFile(options['--prepared'])).toString('utf8')));
      return await publish({
        prepared,
        adapter: await loadAdapter(options['--adapter']),
        artifactDirectory: options['--artifact-dir'],
        galleryRoot: options['--gallery-root'],
        stateRoot: options['--state-root'],
        transactionId: options['--transaction'],
        security,
        fs: seams.fs,
        executor: seams.executor,
        postPublishVerifier: seams.postPublishVerifier,
        authenticatedVerifier: seams.authenticatedVerifier,
      });
    } finally {
      await stagedKey.cleanup();
    }
  }
  fail('usage: publisher.mjs <prepare|publish|rollback> --name value ...');
}

export const commands = { prepare, publish, rollback };

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
