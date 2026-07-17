import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmod as nodeChmod,
  chown as nodeChown,
  constants as fsConstants,
  lstat as nodeLstat,
  mkdir as nodeMkdir,
  open as nodeOpen,
  readFile as nodeReadFile,
  readdir as nodeReaddir,
  realpath as nodeRealpath,
  rename as nodeRename,
  rm as nodeRm,
  statfs as nodeStatfs,
} from 'node:fs/promises';
import { constants as osConstants } from 'node:os';
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
    'chmod', 'chown', 'fsyncDirectory', 'lstat', 'mkdir', 'openExclusive', 'readFile', 'readdir',
    'realpath', 'renameNoReplace', 'renameReplace', 'rm', 'statfs', 'writeAtomic',
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
  const prior = journal.previousIndexMetadata;
  if (!Number.isInteger(prior.uid) || !Number.isInteger(prior.gid) || prior.mode !== 0o644) {
    fail('transaction journal has unsafe prior index metadata');
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

async function inspectLiveState(fs, galleryRoot, journal, security) {
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
  const artifactStat = await lstatOrNull(fs, artifactPath);
  if (artifactStat === null) return { indexState, artifactState: 'absent', artifactPath };
  if (isSymlink(artifactStat) || !isDirectory(artifactStat)) return { indexState, artifactState: 'drift', artifactPath };
  await assertTreeMetadata(fs, artifactPath, security.web, 'promoted artifact');
  const artifact = await checksumTree(fs, artifactPath);
  return {
    indexState,
    artifactState: artifact.sha256 === journal.artifactTreeSha256
      && await checksumArtifactIndex(fs, artifactPath, 'promoted artifact') === journal.artifactIndexSha256
      ? 'candidate'
      : 'drift',
    artifactPath,
  };
}

async function restorePreviousIndex({ fs, galleryRoot, transactionRoot, journal, security }) {
  const previousPath = childPath(transactionRoot, 'previous-index.html');
  const snapshotStat = await assertRegularFile(fs, previousPath, 'previous index snapshot');
  assertExpectedMetadata(snapshotStat, security.state, 'previous index snapshot', security.state.fileMode);
  const previous = toBuffer(await fs.readFile(previousPath), 'previous index snapshot');
  if (sha256(previous) !== journal.previousIndexSha256) fail('rollback refused because the previous index snapshot has drifted');
  await fs.writeAtomic({
    directory: galleryRoot,
    filename: INDEX_NAME,
    contents: previous,
    mode: journal.previousIndexMetadata.mode,
    uid: journal.previousIndexMetadata.uid,
    gid: journal.previousIndexMetadata.gid,
    replace: true,
  });
  const restored = await readIndex(fs, galleryRoot);
  if (sha256(restored.bytes) !== journal.previousIndexSha256) fail('rollback did not restore the byte-identical previous index');
  if (!sameJson(normalizeMetadata(restored.stat), journal.previousIndexMetadata)) {
    fail('rollback did not restore the previous index ownership and mode');
  }
}

async function removeOnlyTransactionArtifact({ fs, executor, galleryRoot, slug }) {
  const artifactPath = childPath(galleryRoot, slug);
  const stat = await assertDirectory(fs, artifactPath, 'transaction artifact');
  if (isSymlink(stat)) fail('transaction artifact must not be a symbolic link');
  await fs.rm(artifactPath, { recursive: true, force: false });
  await fs.fsyncDirectory(galleryRoot);
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
  const state = await inspectLiveState(fs, galleryRoot, journal, security);
  if (candidateStat === null && (state.indexState !== 'previous' || state.artifactState !== 'absent')) {
    fail('recovery refused because the required candidate snapshot is missing');
  }
  if (!rollback && state.indexState === 'drift' && state.artifactState === 'candidate') {
    await setPhase(fs, journalPath, journal, 'recovery-artifact-removing-after-index-drift', security.state, now);
    await removeOnlyTransactionArtifact({ fs, executor, galleryRoot, slug: journal.slug });
    await setPhase(fs, journalPath, journal, 'failed-cleaned-external-drift', security.state, now);
    return { journal: { ...journal }, externalIndexDrift: true };
  }
  if (state.indexState === 'drift' || state.artifactState === 'drift') {
    fail('recovery refused because the live index or artifact has drifted');
  }

  if (state.indexState === 'candidate') {
    await setPhase(fs, journalPath, journal, 'recovery-index-restoring', security.state, now);
    await restorePreviousIndex({ fs, galleryRoot, transactionRoot, journal, security });
  }
  if (state.artifactState === 'candidate') {
    await setPhase(fs, journalPath, journal, 'recovery-artifact-removing', security.state, now);
    await removeOnlyTransactionArtifact({ fs, executor, galleryRoot, slug: journal.slug });
  }

  const reconciled = await inspectLiveState(fs, galleryRoot, journal, security);
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

async function withLock(fs, stateRoot, stateSecurity, label, callback) {
  const locksRoot = childPath(stateRoot, 'locks');
  await ensureStateDirectory(fs, locksRoot, stateSecurity, 'lock state root');
  const lockPath = childPath(locksRoot, 'publisher.lock');
  try {
    await fs.openExclusive(lockPath, `${label}\n`, stateSecurity.fileMode);
  } catch (error) {
    if (error?.code === 'EEXIST') fail('publisher lock is already held');
    throw error;
  }
  try {
    return await callback();
  } finally {
    await fs.rm(lockPath, { force: true });
    await fs.fsyncDirectory(locksRoot);
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

      const beforeIndex = await readIndex(validFs, current.galleryRoot);
      if (sha256(beforeIndex.bytes) !== journal.previousIndexSha256) fail('publish refused because the live index has drifted');
      assertAdapterIdentity(validAdapter, journal.adapterFingerprint, journal.adapterVersion, beforeIndex.bytes);
      if ((await checksumTree(validFs, artifactPath)).sha256 !== journal.artifactTreeSha256) {
        fail('publish refused because the promoted artifact has drifted');
      }
      if (await checksumArtifactIndex(validFs, artifactPath, 'promoted artifact') !== journal.artifactIndexSha256) {
        fail('publish refused because the promoted artifact index has drifted');
      }
      await assertStageIndex(validFs, stagedIndex, regenerated, current.indexMetadata);
      await setPhase(validFs, journalPath, journal, 'index-promoting', validSecurity.state, now, phaseHook);
      await validFs.renameReplace(stagedIndex, childPath(current.galleryRoot, INDEX_NAME));
      await validFs.fsyncDirectory(current.galleryRoot);
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
        });
      } catch (recoveryFailure) {
        recoveryError = recoveryFailure;
      }
      if (recoveryError) {
        throw new PublisherError('publication failed and durable recovery could not be verified', { cause: recoveryError });
      }
      throw error;
    }
  });
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
}) {
  const validFs = assertFilesystem(fs);
  const validExecutor = assertExecutor(executor);
  const validSecurity = normalizeSecurity(security);
  const validTransactionId = assertTransactionId(transactionId);
  if (typeof authenticatedVerifier !== 'function') fail('rollback requires an authenticated former-artifact verifier');
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
    });
  });
}

const RENAMEAT2_NO_REPLACE = String.raw`
import ctypes
import os
import platform
import sys

numbers = {'x86_64': 316, 'aarch64': 276, 'arm64': 276}
number = numbers.get(platform.machine().lower())
if number is None:
    raise SystemExit('unsupported architecture for renameat2')
libc = ctypes.CDLL(None, use_errno=True)
result = libc.syscall(number, -100, os.fsencode(sys.argv[1]), -100, os.fsencode(sys.argv[2]), 1)
if result != 0:
    error = ctypes.get_errno()
    sys.stderr.write(f'renameat2-errno:{error}\n')
    raise SystemExit(1)
`;

function errnoCode(errno) {
  return Object.entries(osConstants.errno).find(([, value]) => value === errno)?.[0] ?? 'ERENAMEAT2';
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
    async renameNoReplace(source, destination) {
      try {
        await executeFile('python3', ['-c', RENAMEAT2_NO_REPLACE, source, destination], { maxBuffer: 1024 });
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
          const failure = new Error(`atomic no-replace rename failed: ${code}`);
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
    },
    rm: nodeRm,
    statfs: nodeStatfs,
    writeAtomic,
    async openExclusive(target, contents, mode) {
      const handle = await nodeOpen(
        target,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
        mode,
      );
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) fail('exclusive lock path is not a regular file');
        await handle.writeFile(contents);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fsyncDirectory(path.dirname(target));
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

export function createSshExecutor({ keyFile, host, user, run }) {
  if (typeof keyFile !== 'string' || !path.isAbsolute(keyFile) || keyFile.includes('\0')) {
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

export async function runCli(argv, { fs = createNodeFilesystem(), stdout = process.stdout } = {}) {
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
    const security = JSON.parse((await fs.readFile(options['--security'])).toString('utf8'));
    const seams = await loadPublisherSeams(options['--executor-module'], {
      keyFile: options['--key-file'],
      host: options['--ssh-host'],
      user: options['--ssh-user'],
    });
    if (command === 'rollback') {
      return rollback({
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
    return publish({
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
