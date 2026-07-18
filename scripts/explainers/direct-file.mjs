import { createHash } from 'node:crypto';
import { writeFile as nodeWriteFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

import {
  assertAbsolutePath,
  assertExecutor,
  assertFixedRemoteRoots,
  assertFilesystem,
  assertSshTarget,
  assertTargetAbsent,
  constants,
  createLocalExecutor,
  createNodeFilesystem,
  fixedTarget,
  makeStateDirectory,
  ensureStateDirectory,
  normalizeSecurity,
  preflightFixedRoots,
  quarantineTarget,
  readJsonFile,
  stageCliKeyFile,
  stagingTarget,
  syncJournal,
  setJournalPhase,
  transactionRoot,
} from './direct-file-primitives.mjs';

export const DIRECT_FILE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'; connect-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export const DIRECT_FILE_POLICY_VERSION = 'direct-file-policy-v1';
const SCHEMA_VERSION = 1;
const SHA256 = /^[a-f0-9]{64}$/;
const METADATA_KEYS = new Set(['schemaVersion', 'slug', 'title', 'summary', 'createdAt', 'artifactSha256']);

export class DirectFileValidationError extends Error {
  constructor(message, options) { super(message, options); this.name = 'DirectFileValidationError'; }
}

function fail(message) { throw new DirectFileValidationError(message); }
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function toBuffer(value, label) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  fail(`${label} must be bytes`);
}
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNoSecretShape(value) {
  if (typeof value !== 'string') return;
  if (/(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:ghp|github_pat|AKIA|sk|pk)_[A-Za-z0-9_-]{16,}|\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*\S+)/i.test(value)) {
    fail('direct-file inputs contain a secret-shaped value');
  }
}

function validateMetadata(metadata) {
  if (!isPlainObject(metadata) || Object.keys(metadata).length !== METADATA_KEYS.size || Object.keys(metadata).some((key) => !METADATA_KEYS.has(key))) fail('metadata must contain exactly the direct-file schema fields');
  if (metadata.schemaVersion !== 1 || metadata.slug !== constants.directSlug) fail('metadata has an unauthorized direct-file schema or slug');
  for (const field of ['title', 'summary']) {
    if (typeof metadata[field] !== 'string' || metadata[field].trim() === '') fail(`metadata.${field} must be non-empty`);
    assertNoSecretShape(metadata[field]);
  }
  if (typeof metadata.createdAt !== 'string' || Number.isNaN(Date.parse(metadata.createdAt)) || new Date(metadata.createdAt).toISOString() !== metadata.createdAt) fail('metadata.createdAt must be canonical UTC ISO-8601');
  if (typeof metadata.artifactSha256 !== 'string' || !SHA256.test(metadata.artifactSha256)) fail('metadata.artifactSha256 must be a lowercase SHA-256 hash');
  return JSON.parse(JSON.stringify(metadata));
}

export function directFilename(slug = constants.directSlug) {
  if (slug !== constants.directSlug) fail('direct-file slug is outside the authorized target');
  return constants.directFilename;
}

export function directUrl(slug = constants.directSlug) { return `/explainers/${directFilename(slug)}`; }

function attributeValue(tag, name) {
  return new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i').exec(tag)?.[2] ?? null;
}

function assertHtmlPolicy(bytes) {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes) || text.includes('\0') || !/^\s*<!doctype html\b/i.test(text) || !/<html\b[^>]*>[\s\S]*<\/html\s*>/i.test(text)) fail('direct artifact must be a complete HTML document');
  const cspTags = [...text.matchAll(/<meta\b[^>]*>/gi)].filter(([tag]) => attributeValue(tag, 'http-equiv')?.toLowerCase() === 'content-security-policy');
  if (cspTags.length !== 1 || attributeValue(cspTags[0][0], 'content') !== DIRECT_FILE_CSP) fail('direct artifact must declare the exact restrictive CSP');
  for (const marker of [
    /<(?:script|iframe|form|object|embed|base|link)\b/i, /serviceWorker/i, /\bfetch\s*\(/i,
    /XMLHttpRequest/i, /(?:WebSocket|EventSource|sendBeacon)/i, /@import/i, /javascript\s*:/i,
    /\bon[a-z]+\s*=/i, /\burl\s*\(/i, /\b(?:src|href|action|poster)\s*=\s*[^"'\s>]/i,
  ]) if (marker.test(text)) fail('direct artifact contains a script, network surface, remote asset, form, or executable handler');
  for (const match of text.matchAll(/\b(src|href|action|poster)\s*=\s*(["'])([\s\S]*?)\2/gi)) {
    const [, name, , value] = match;
    const allowedAnchor = name.toLowerCase() === 'href' && value.startsWith('#');
    const allowedImageData = name.toLowerCase() === 'src' && /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(value);
    if (!allowedAnchor && !allowedImageData) fail('direct artifact contains a script, network surface, remote asset, form, or executable handler');
  }
  assertNoSecretShape(text);
  return text;
}

export function prepareDirectFile({ artifactBytes, metadata, artifactBodyMarker }) {
  const bytes = toBuffer(artifactBytes, 'artifactBytes');
  const validMetadata = validateMetadata(metadata);
  if (hash(bytes) !== validMetadata.artifactSha256) fail('artifact bytes do not match metadata.artifactSha256');
  const text = assertHtmlPolicy(bytes);
  const forbiddenStrings = [validMetadata.title];
  if (artifactBodyMarker !== undefined) {
    if (typeof artifactBodyMarker !== 'string' || artifactBodyMarker.trim() === '' || !text.includes(artifactBodyMarker)) fail('artifactBodyMarker must be present in the artifact');
    forbiddenStrings.push(artifactBodyMarker);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'direct-file',
    slug: validMetadata.slug,
    filename: directFilename(validMetadata.slug),
    url: directUrl(validMetadata.slug),
    metadata: validMetadata,
    artifactSha256: validMetadata.artifactSha256,
    artifactSize: bytes.length,
    csp: DIRECT_FILE_CSP,
    policyVersion: DIRECT_FILE_POLICY_VERSION,
    forbiddenStrings,
    artifactBytesBase64: bytes.toString('base64'),
  };
}

export function assertPreparedDirectFile(prepared) {
  if (!isPlainObject(prepared) || prepared.schemaVersion !== SCHEMA_VERSION || prepared.kind !== 'direct-file') fail('prepared direct file has an unsupported schema');
  const metadata = validateMetadata(prepared.metadata);
  if (typeof prepared.artifactBytesBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(prepared.artifactBytesBase64)) fail('prepared direct file is missing artifact bytes');
  const bytes = Buffer.from(prepared.artifactBytesBase64, 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== prepared.artifactBytesBase64) fail('prepared direct file is missing artifact bytes');
  if (prepared.slug !== metadata.slug || prepared.filename !== directFilename(metadata.slug) || prepared.url !== directUrl(metadata.slug)) fail('prepared direct file has inconsistent fixed identity');
  if (prepared.artifactSha256 !== metadata.artifactSha256 || !SHA256.test(prepared.artifactSha256) || hash(bytes) !== prepared.artifactSha256) fail('prepared direct file hash does not match its bytes');
  if (prepared.artifactSize !== bytes.length) fail('prepared direct file size does not match its bytes');
  if (prepared.csp !== DIRECT_FILE_CSP || prepared.policyVersion !== DIRECT_FILE_POLICY_VERSION) fail('prepared direct file has an unsupported policy');
  if (!Array.isArray(prepared.forbiddenStrings) || prepared.forbiddenStrings.length === 0 || prepared.forbiddenStrings.some((value) => typeof value !== 'string' || value.trim() === '')) fail('prepared direct file has invalid forbidden response markers');
  assertHtmlPolicy(bytes);
  return { ...prepared, metadata, forbiddenStrings: [...prepared.forbiddenStrings] };
}

export function serializableDirectFile(prepared) { return assertPreparedDirectFile(prepared); }

export function deserializeDirectFile(value) { return assertPreparedDirectFile(value); }

function preparedBytes(prepared) { return Buffer.from(prepared.artifactBytesBase64, 'base64'); }

function journalFor(prepared, transactionId, security, phase = 'prepared') {
  return {
    schemaVersion: 1,
    kind: 'direct-file',
    transactionId,
    slug: prepared.slug,
    filename: prepared.filename,
    url: prepared.url,
    artifactSha256: prepared.artifactSha256,
    artifactSize: prepared.artifactSize,
    metadata: prepared.metadata,
    csp: prepared.csp,
    policyVersion: prepared.policyVersion,
    forbiddenStrings: prepared.forbiddenStrings,
    targetPath: fixedTarget(constants.galleryRoot, prepared.slug),
    stagingPath: stagingTarget(constants.stateRoot, transactionId, prepared.slug),
    quarantinePath: quarantineTarget(constants.stateRoot, transactionId, prepared.slug),
    artifactIdentity: { type: 'regular', uid: security.web.uid, gid: security.web.gid, mode: security.web.fileMode },
    phase,
    phases: {},
    externalVerification: { status: 'pending' },
  };
}

function validateJournal(journal, transactionId, security) {
  if (!isPlainObject(journal) || journal.schemaVersion !== 1 || journal.kind !== 'direct-file' || journal.transactionId !== transactionId) fail('transaction journal is not the requested direct-file transaction');
  const metadata = validateMetadata(journal.metadata);
  if (journal.slug !== constants.directSlug || journal.filename !== constants.directFilename || journal.url !== directUrl(constants.directSlug) || metadata.slug !== journal.slug) fail('transaction journal has an inconsistent fixed identity');
  if (journal.artifactSha256 !== metadata.artifactSha256 || !SHA256.test(journal.artifactSha256) || !Number.isSafeInteger(journal.artifactSize) || journal.artifactSize < 1) fail('transaction journal has an invalid artifact identity');
  if (journal.csp !== DIRECT_FILE_CSP || journal.policyVersion !== DIRECT_FILE_POLICY_VERSION || !Array.isArray(journal.forbiddenStrings) || journal.forbiddenStrings.some((value) => typeof value !== 'string' || value.trim() === '')) fail('transaction journal has an invalid content policy');
  if (journal.targetPath !== fixedTarget(constants.galleryRoot, journal.slug) || journal.stagingPath !== stagingTarget(constants.stateRoot, transactionId, journal.slug) || journal.quarantinePath !== quarantineTarget(constants.stateRoot, transactionId, journal.slug)) fail('transaction journal has an unsafe fixed path');
  if (!isPlainObject(journal.artifactIdentity) || journal.artifactIdentity.type !== 'regular' || journal.artifactIdentity.uid !== security.web.uid || journal.artifactIdentity.gid !== security.web.gid || journal.artifactIdentity.mode !== security.web.fileMode) fail('transaction journal has an invalid file identity');
  if (!isPlainObject(journal.phases) || typeof journal.phase !== 'string') fail('transaction journal has invalid phase state');
  return journal;
}

function bodyOf(response) { return typeof response?.body === 'string' ? Buffer.from(response.body) : toBuffer(response?.body, 'external response body'); }
function header(response, name) {
  if (!response?.headers) return '';
  if (typeof response.headers.get === 'function') return response.headers.get(name) ?? '';
  return String(response.headers[name] ?? response.headers[name.toLowerCase()] ?? '');
}

function verifyCurrentResponse(response, journal) {
  if (!response || response.status !== 200) fail('external direct-file response was not HTTP 200');
  const body = bodyOf(response);
  if (body.length !== journal.artifactSize || hash(body) !== journal.artifactSha256) fail('external direct-file response does not match the artifact');
  const robots = header(response, 'x-robots-tag');
  if (!robots || !/noindex\s*,?\s*nofollow\s*,?\s*noarchive/i.test(robots)) fail('external direct-file response has a missing or unsafe X-Robots-Tag');
  if (Array.isArray(response.resources) && response.resources.length !== 0) fail('external direct-file response loaded unexpected resources');
  return { responseStatus: response.status, bodySha256: hash(body) };
}

function verifyFormerResponse(response, journal) {
  if (!response || ![200, 404].includes(response.status)) fail('former direct-file response was not HTTP 404 or a valid shell fallback');
  const body = bodyOf(response);
  if (hash(body) === journal.artifactSha256 || journal.forbiddenStrings.some((marker) => body.includes(Buffer.from(marker)))) fail('former direct-file response still matches artifact content');
  return { responseStatus: response.status, bodySha256: hash(body) };
}

async function targetIdentity(fs, target, journal, security) {
  const stat = await fs.lstat(target).catch((error) => { if (error?.code === 'ENOENT') return null; throw error; });
  if (stat === null) return 'absent';
  if (!stat.isFile?.() || stat.isSymbolicLink?.()) return 'drift';
  const metadata = { uid: stat.uid, gid: stat.gid, mode: stat.mode & 0o777 };
  if (metadata.uid !== journal.artifactIdentity.uid || metadata.gid !== journal.artifactIdentity.gid || metadata.mode !== journal.artifactIdentity.mode) return 'drift';
  const bytes = Buffer.from(await fs.readFile(target));
  if (bytes.length !== journal.artifactSize || hash(bytes) !== journal.artifactSha256) return 'drift';
  try {
    assertHtmlPolicy(bytes);
  } catch { return 'drift'; }
  return { state: 'candidate', metadata, bytes };
}

async function removeOwnedFile({ fs, executor, target, quarantine, journal, security, transactionRoot, journalPath, now, phaseHook }) {
  const live = await targetIdentity(fs, target, journal, security);
  const held = await targetIdentity(fs, quarantine, journal, security);
  if (live === 'drift' || held === 'drift') fail('direct-file server identity drift refuses deletion');
  if (live?.state === 'candidate' && held?.state === 'candidate') fail('direct-file live and quarantine copies are ambiguous');
  if (live?.state === 'candidate') {
    await ensureStateDirectory(fs, path.dirname(quarantine), security.state);
    await setJournalPhase(fs, journalPath, journal, 'artifact-quarantining', security.state, now, phaseHook);
    await fs.renameNoReplace(target, quarantine);
    await fs.fsyncDirectory(path.dirname(target));
    await fs.fsyncDirectory(path.dirname(quarantine));
    await setJournalPhase(fs, journalPath, journal, 'artifact-quarantined', security.state, now, phaseHook);
  }
  const verified = await targetIdentity(fs, quarantine, journal, security);
  if (verified !== 'absent' && verified?.state !== 'candidate') fail('quarantined direct-file identity drift refuses deletion');
  if (verified?.state === 'candidate') {
    await setJournalPhase(fs, journalPath, journal, 'artifact-removing', security.state, now, phaseHook);
    await fs.rm(quarantine, { recursive: false, force: false });
    await fs.fsyncDirectory(path.dirname(quarantine));
  }
  const localAbsent = await fs.lstat(target).then(() => false).catch((error) => error?.code === 'ENOENT');
  if (!localAbsent) fail('direct-file target was not removed');
  const remoteLstat = await executor.lstat(target);
  if (!remoteLstat || remoteLstat.exists !== false) fail('remote lstat did not prove the fixed target absent');
  if (await executor.testAbsent(target) !== true) fail('remote test ! -e did not prove the fixed target absent');
  void transactionRoot;
}

async function recordExternal(journal, journalPath, fs, security, now, verifier, context, mode) {
  if (typeof verifier !== 'function') {
    journal.externalVerification = { status: 'pending', mode };
    await syncJournal(fs, journalPath, journal, security, now);
    return journal.externalVerification;
  }
  try {
    const response = await verifier(context);
    const evidence = mode === 'current' ? verifyCurrentResponse(response, journal) : verifyFormerResponse(response, journal);
    // Keep the journal's verification state distinct from the HTTP response
    // status included in the corroborating evidence (for example, 200).
    journal.externalVerification = { mode, ...evidence, status: 'verified' };
  } catch (error) {
    const unavailable = error?.externalUnavailable === true
      || ['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'].includes(error?.code)
      || /(?:https?|network|fetch|socket|connect|timed?\s*out)\s+(?:unavailable|failed|error|refused|reset|timeout)/i.test(error?.message ?? '');
    journal.externalVerification = { status: unavailable ? 'pending' : 'failed', mode, reason: unavailable ? 'unavailable' : 'verification-failed' };
  }
  await syncJournal(fs, journalPath, journal, security, now);
  return journal.externalVerification;
}

export async function publishDirectFile({ prepared, galleryRoot = constants.galleryRoot, stateRoot = constants.stateRoot, transactionId, security, fs = createNodeFilesystem(), executor = createLocalExecutor(fs), postPublishVerifier, now = () => new Date(), phaseHook }) {
  const reviewed = assertPreparedDirectFile(prepared);
  const artifactBytes = preparedBytes(reviewed);
  const validFs = assertFilesystem(fs); const validExecutor = assertExecutor(executor); const validSecurity = normalizeSecurity(security);
  const fixedRoots = assertFixedRemoteRoots(galleryRoot, stateRoot);
  const roots = await preflightFixedRoots({ fs: validFs, ...fixedRoots, security: validSecurity, requiredBytes: Math.max(validSecurity.minFreeBytes, reviewed.artifactSize * 3 + 65_536) });
  const target = fixedTarget(roots.galleryRoot, reviewed.slug);
  const txRoot = transactionRoot(roots.stateRoot, transactionId);
  const stageRoot = path.dirname(stagingTarget(roots.stateRoot, transactionId, reviewed.slug));
  const journalPath = path.join(txRoot, 'transaction.json');
  const reviewedPath = path.join(txRoot, 'reviewed-direct-file.json');
  const existingTransaction = await validFs.lstat(txRoot).then(() => true).catch((error) => { if (error?.code === 'ENOENT') return false; throw error; });
  if (existingTransaction) fail('transaction ID already exists');
  await assertTargetAbsent({ fs: validFs, executor: validExecutor, galleryRoot: roots.galleryRoot, slug: reviewed.slug });
  await ensureStateDirectory(validFs, path.join(roots.stateRoot, 'transactions'), validSecurity.state);
  await ensureStateDirectory(validFs, path.join(roots.stateRoot, 'staging'), validSecurity.state);
  await makeStateDirectory(validFs, txRoot, validSecurity.state);
  const journal = journalFor(reviewed, transactionId, validSecurity);
  await syncJournal(validFs, journalPath, journal, validSecurity.state, now);
  await validFs.writeAtomic({ directory: txRoot, filename: 'reviewed-direct-file.json', contents: `${JSON.stringify(serializableDirectFile(reviewed), null, 2)}\n`, mode: validSecurity.state.fileMode, uid: validSecurity.state.uid, gid: validSecurity.state.gid, replace: false });
  try {
    await setJournalPhase(validFs, journalPath, journal, 'uploading', validSecurity.state, now, phaseHook);
    await makeStateDirectory(validFs, stageRoot, validSecurity.state);
    const staged = stagingTarget(roots.stateRoot, transactionId, reviewed.slug);
    await validFs.writeAtomic({ directory: stageRoot, filename: reviewed.filename, contents: artifactBytes, mode: validSecurity.web.fileMode, uid: validSecurity.web.uid, gid: validSecurity.web.gid, replace: false });
    const stagedIdentity = await targetIdentity(validFs, staged, journal, validSecurity);
    if (!stagedIdentity || stagedIdentity.state !== 'candidate') fail('staged direct-file identity failed validation');
    await validFs.fsyncDirectory(stageRoot);
    await setJournalPhase(validFs, journalPath, journal, 'uploaded', validSecurity.state, now, phaseHook);
    await assertTargetAbsent({ fs: validFs, executor: validExecutor, galleryRoot: roots.galleryRoot, slug: reviewed.slug });
    await setJournalPhase(validFs, journalPath, journal, 'promoting', validSecurity.state, now, phaseHook);
    await validFs.renameNoReplace(staged, target);
    await validFs.fsyncDirectory(roots.galleryRoot);
    if ((await targetIdentity(validFs, target, journal, validSecurity)).state !== 'candidate') fail('promoted direct-file identity failed validation');
    await setJournalPhase(validFs, journalPath, journal, 'promoted', validSecurity.state, now, phaseHook);
    const external = await recordExternal(journal, journalPath, validFs, validSecurity.state, now, postPublishVerifier, { phase: 'after-publish', transactionId, slug: reviewed.slug, filename: reviewed.filename, url: reviewed.url, artifactSha256: reviewed.artifactSha256 }, 'current');
    if (typeof postPublishVerifier === 'function' && external.status !== 'verified') fail('external direct-file verification failed');
    await setJournalPhase(validFs, journalPath, journal, 'published', validSecurity.state, now, phaseHook);
    return { transactionId, transactionRoot: txRoot, journal: { ...journal }, prepared: serializableDirectFile(reviewed) };
  } catch (error) {
    try { await rollbackDirectFile({ galleryRoot: roots.galleryRoot, stateRoot: roots.stateRoot, transactionId, security: validSecurity, fs: validFs, executor: validExecutor, now, phaseHook }); } catch (recoveryError) { throw new DirectFileValidationError(`direct-file publication recovery failed: ${recoveryError.message}`, { cause: error }); }
    throw error;
  }
}

export async function rollbackDirectFile({ galleryRoot = constants.galleryRoot, stateRoot = constants.stateRoot, transactionId, security, fs = createNodeFilesystem(), executor = createLocalExecutor(fs), authenticatedVerifier, now = () => new Date(), phaseHook }) {
  const validFs = assertFilesystem(fs); const validExecutor = assertExecutor(executor); const validSecurity = normalizeSecurity(security);
  const fixedRoots = assertFixedRemoteRoots(galleryRoot, stateRoot);
  const roots = await preflightFixedRoots({ fs: validFs, ...fixedRoots, security: validSecurity, requiredBytes: validSecurity.minFreeBytes });
  const txRoot = transactionRoot(roots.stateRoot, transactionId); const journalPath = path.join(txRoot, 'transaction.json');
  const journal = validateJournal(await readJsonFile(validFs, journalPath, validSecurity.state, 'direct-file transaction journal'), transactionId, validSecurity);
  if (journal.phase === 'rolled-back') fail('direct-file transaction is already rolled back');
  const target = journal.targetPath; const staged = journal.stagingPath; const quarantine = journal.quarantinePath;
  const live = await targetIdentity(validFs, target, journal, validSecurity); const stagedState = await targetIdentity(validFs, staged, journal, validSecurity); const quarantinedState = await targetIdentity(validFs, quarantine, journal, validSecurity);
  if (live === 'drift' || stagedState === 'drift' || quarantinedState === 'drift') fail('direct-file server identity drift refuses rollback');
  const promotionAuthority = Boolean(journal.phases.promoting) || ['promoting', 'promoted', 'published', 'artifact-quarantining', 'artifact-quarantined', 'artifact-removing'].includes(journal.phase);
  if ((live?.state === 'candidate' || quarantinedState?.state === 'candidate') && !promotionAuthority) fail('incomplete journal phase does not authorize direct-file removal');
  if (live?.state === 'candidate') await recordExternal(journal, journalPath, validFs, validSecurity.state, now, authenticatedVerifier, { phase: 'before-rollback', transactionId, slug: journal.slug, filename: journal.filename, url: journal.url, artifactSha256: journal.artifactSha256 }, 'current');
  if (live?.state === 'candidate' || quarantinedState?.state === 'candidate') {
    await removeOwnedFile({ fs: validFs, executor: validExecutor, target, quarantine, journal, security: validSecurity, transactionRoot: txRoot, journalPath, now, phaseHook });
  } else if (stagedState?.state === 'candidate') {
    await setJournalPhase(validFs, journalPath, journal, 'staged-removing', validSecurity.state, now, phaseHook);
    await validFs.rm(staged, { recursive: false, force: false });
    await validFs.fsyncDirectory(path.dirname(staged));
    const remoteLstat = await validExecutor.lstat(target);
    if (!remoteLstat || remoteLstat.exists !== false) fail('remote lstat did not prove the fixed target absent');
    if (await validExecutor.testAbsent(target) !== true) fail('remote test ! -e did not prove the fixed target absent');
  } else if (live !== 'absent' || stagedState !== 'absent' || quarantinedState !== 'absent') fail('direct-file rollback found ambiguous state');
  await assertTargetAbsent({ fs: validFs, executor: validExecutor, galleryRoot: roots.galleryRoot, slug: journal.slug });
  await setJournalPhase(validFs, journalPath, journal, 'rolled-back', validSecurity.state, now, phaseHook);
  await recordExternal(journal, journalPath, validFs, validSecurity.state, now, authenticatedVerifier, { phase: 'after-rollback', transactionId, slug: journal.slug, filename: journal.filename, url: journal.url, artifactSha256: journal.artifactSha256 }, 'former');
  return { transactionId, transactionRoot: txRoot, journal: { ...journal } };
}

function parseOptions(args) {
  if (args.length % 2 !== 0) fail('CLI options must be --name value pairs');
  const result = {};
  for (let index = 0; index < args.length; index += 2) { if (!args[index].startsWith('--') || result[args[index]] !== undefined) fail('CLI options must be unique named pairs'); result[args[index]] = args[index + 1]; }
  return result;
}

function assertOptionSet(options, allowed) {
  for (const key of Object.keys(options)) if (!allowed.includes(key)) fail('CLI option is outside the direct-file allowlist');
}

function requireAbsoluteOptions(options, keys, command) {
  for (const key of keys) {
    if (!options[key]) fail(`${command} requires ${key}`);
    assertAbsolutePath(options[key], key);
  }
}

export async function runCli(argv, { stdout = process.stdout } = {}) {
  const [command, ...rest] = argv; const options = parseOptions(rest); const fs = createNodeFilesystem();
  if (command === 'prepare-file') {
    assertOptionSet(options, ['--artifact', '--metadata', '--output']);
    requireAbsoluteOptions(options, ['--artifact', '--metadata', '--output'], command);
    const prepared = prepareDirectFile({ artifactBytes: await fs.readFile(options['--artifact']), metadata: JSON.parse((await fs.readFile(options['--metadata'])).toString('utf8')) });
    await nodeWriteFile(options['--output'], `${JSON.stringify(serializableDirectFile(prepared), null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    stdout.write(`${options['--output']}\n`); return prepared;
  }
  if (command !== 'publish-file' && command !== 'rollback-file') fail('usage: direct-file.mjs <prepare-file|publish-file|rollback-file> --name value ...');
  assertOptionSet(options, command === 'publish-file'
    ? ['--prepared', '--key-file', '--transaction', '--security', '--executor-module', '--ssh-host', '--ssh-user']
    : ['--key-file', '--transaction', '--security', '--executor-module', '--ssh-host', '--ssh-user']);
  requireAbsoluteOptions(options, command === 'publish-file'
    ? ['--prepared', '--key-file', '--security', '--executor-module']
    : ['--key-file', '--security', '--executor-module'], command);
  if (!options['--transaction']) fail(`${command} requires --transaction`);
  const ssh = assertSshTarget({ host: options['--ssh-host'], user: options['--ssh-user'] });
  const stagedKey = await stageCliKeyFile(options['--key-file']);
  try {
    const security = JSON.parse((await fs.readFile(options['--security'])).toString('utf8'));
    const seams = await (await import('./direct-file-primitives.mjs')).loadSeams(options['--executor-module'], { keyFile: stagedKey.keyFile, ...ssh, galleryRoot: constants.galleryRoot, stateRoot: constants.stateRoot });
    if (command === 'rollback-file') return rollbackDirectFile({ transactionId: options['--transaction'], security, fs: seams.fs, executor: seams.executor, authenticatedVerifier: seams.authenticatedVerifier });
    const prepared = deserializeDirectFile(JSON.parse((await fs.readFile(options['--prepared'])).toString('utf8')));
    return publishDirectFile({ prepared, transactionId: options['--transaction'], security, fs: seams.fs, executor: seams.executor, postPublishVerifier: seams.postPublishVerifier });
  } finally { await stagedKey.cleanup(); }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) runCli(process.argv.slice(2)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
