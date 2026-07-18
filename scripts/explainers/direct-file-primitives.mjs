import { constants as fsConstants } from 'node:fs';
import {
  chmod as nodeChmod,
  chown as nodeChown,
  lstat as nodeLstat,
  mkdir as nodeMkdir,
  mkdtemp as nodeMkdtemp,
  open as nodeOpen,
  readFile as nodeReadFile,
  realpath as nodeRealpath,
  rmdir as nodeRmdir,
  rm as nodeRm,
  statfs as nodeStatfs,
} from 'node:fs/promises';
import { constants as osConstants, tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const executeFile = promisify(execFile);
const SHA256 = /^[a-f0-9]{64}$/;
const TRANSACTION_ID = /^[a-z0-9][a-z0-9-]{0,95}$/;
const SAFE_COMPONENT = /^[a-z0-9][a-z0-9.-]{0,95}$/;
const DIRECT_SLUG = 'dex-brain-vault-capability-architecture';
const DIRECT_FILENAME = `${DIRECT_SLUG}.html`;
const DIRECT_GALLERY_ROOT = '/var/www/explainers';
const DIRECT_STATE_ROOT = '/var/www/.heydex-explainer-publisher';
const TEMP_ATTEMPTS = 16;

export class DirectFilePrimitiveError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'DirectFilePrimitiveError';
  }
}

function fail(message) {
  throw new DirectFilePrimitiveError(message);
}

function isNotFound(error) { return error?.code === 'ENOENT'; }
function isSymlink(stat) { return typeof stat?.isSymbolicLink === 'function' && stat.isSymbolicLink(); }
function isFile(stat) { return typeof stat?.isFile === 'function' && stat.isFile(); }
function isDirectory(stat) { return typeof stat?.isDirectory === 'function' && stat.isDirectory(); }
function modeOf(stat) { return stat.mode & 0o777; }
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function childPath(root, ...segments) {
  const absolute = path.resolve(root);
  const target = path.resolve(absolute, ...segments);
  if (!target.startsWith(`${absolute}${path.sep}`)) fail('computed direct-file path escapes its configured root');
  return target;
}

export function assertAbsolutePath(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value !== path.normalize(value) || value.includes('\0')) {
    fail(`${label} must be an absolute normalized path`);
  }
  return value;
}

export function assertFixedRemoteRoots(galleryRoot, stateRoot) {
  if (galleryRoot !== DIRECT_GALLERY_ROOT || stateRoot !== DIRECT_STATE_ROOT) {
    fail('direct-file remote roots are fixed and cannot be overridden');
  }
  return { galleryRoot: DIRECT_GALLERY_ROOT, stateRoot: DIRECT_STATE_ROOT };
}

function assertTransactionId(value) {
  if (typeof value !== 'string' || !TRANSACTION_ID.test(value)) fail('transactionId must be a lowercase hyphenated identifier');
  return value;
}

function assertOneSafeComponent(value, label) {
  if (typeof value !== 'string' || !SAFE_COMPONENT.test(value) || value === '.' || value === '..') fail(`${label} is not a safe path component`);
  return value;
}

export function fixedFilename(slug = DIRECT_SLUG) {
  if (slug !== DIRECT_SLUG) fail('direct-file slug is outside the authorized fixed target');
  return DIRECT_FILENAME;
}

export function fixedTarget(galleryRoot, slug = DIRECT_SLUG) {
  const root = assertAbsolutePath(galleryRoot, 'gallery root');
  return childPath(root, fixedFilename(slug));
}

export function stagingTarget(stateRoot, transactionId, slug = DIRECT_SLUG) {
  const root = assertAbsolutePath(stateRoot, 'state root');
  const id = assertTransactionId(transactionId);
  return childPath(childPath(root, 'staging', id), fixedFilename(slug));
}

export function transactionRoot(stateRoot, transactionId) {
  return childPath(childPath(stateRoot, 'transactions'), assertTransactionId(transactionId));
}

export function quarantineTarget(stateRoot, transactionId, slug = DIRECT_SLUG) {
  return childPath(childPath(transactionRoot(stateRoot, transactionId), 'quarantine'), fixedFilename(slug));
}

export function assertFilesystem(fs) {
  for (const method of ['chmod', 'chown', 'fsyncDirectory', 'lstat', 'mkdir', 'readFile', 'realpath', 'renameNoReplace', 'rm', 'statfs', 'writeAtomic']) {
    if (typeof fs?.[method] !== 'function') fail(`filesystem seam is missing ${method}`);
  }
  return fs;
}

export function assertExecutor(executor) {
  for (const method of ['lstat', 'testAbsent']) {
    if (typeof executor?.[method] !== 'function') fail(`executor seam is missing ${method}`);
  }
  return executor;
}

async function lstatOrNull(fs, target) {
  try { return await fs.lstat(target); } catch (error) { if (isNotFound(error)) return null; throw error; }
}

export async function assertRegularFile(fs, target, label) {
  const stat = await lstatOrNull(fs, target);
  if (stat === null || isSymlink(stat) || !isFile(stat)) fail(`${label} must be an existing regular file`);
  return stat;
}

async function assertDirectory(fs, target, label) {
  const stat = await lstatOrNull(fs, target);
  if (stat === null || isSymlink(stat) || !isDirectory(stat)) fail(`${label} must be an existing real directory`);
  return stat;
}

async function assertNoSymlinkComponents(fs, target, label) {
  const absolute = assertAbsolutePath(target, label);
  const parsed = path.parse(absolute);
  let cursor = parsed.root;
  for (const component of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    const stat = await lstatOrNull(fs, cursor);
    if (stat === null) fail(`${label} has a missing path component`);
    if (isSymlink(stat)) fail(`${label} has a symbolic-link path component`);
  }
}

async function canonicalDirectory(fs, target, label) {
  const absolute = assertAbsolutePath(target, label);
  await assertNoSymlinkComponents(fs, absolute, label);
  const real = await fs.realpath(absolute);
  if (real !== absolute) fail(`${label} must not resolve through a symbolic link`);
  const stat = await assertDirectory(fs, absolute, label);
  return { path: absolute, stat };
}

function assertMetadata(stat, expected, label, expectedMode) {
  if (!Number.isInteger(stat?.uid) || !Number.isInteger(stat?.gid) || stat.uid !== expected.uid || stat.gid !== expected.gid || modeOf(stat) !== expectedMode) {
    fail(`${label} owner, group, or mode does not match policy`);
  }
  return { uid: stat.uid, gid: stat.gid, mode: modeOf(stat) };
}

function freeBytes(value) {
  const bsize = Number(value?.bsize); const bavail = Number(value?.bavail);
  if (!Number.isSafeInteger(bsize) || !Number.isSafeInteger(bavail) || bsize < 1 || bavail < 0) fail('statfs returned invalid free-space metadata');
  const result = bsize * bavail;
  if (!Number.isSafeInteger(result)) fail('statfs free space exceeds safe integer range');
  return result;
}

export function normalizeSecurity(security) {
  if (!isPlainObject(security)) fail('security policy is required');
  for (const [area, modes] of Object.entries({ web: { directoryMode: 0o755, fileMode: 0o644 }, state: { directoryMode: 0o700, fileMode: 0o600 } })) {
    const policy = security[area];
    if (!isPlainObject(policy) || !Number.isInteger(policy.uid) || !Number.isInteger(policy.gid)) fail(`security.${area} must declare uid and gid`);
    for (const [key, expected] of Object.entries(modes)) if (policy[key] !== expected) fail(`security.${area}.${key} must be ${expected.toString(8)}`);
  }
  if (!Number.isSafeInteger(security.minFreeBytes) || security.minFreeBytes < 0) fail('security.minFreeBytes must be a non-negative safe integer');
  return { web: { ...security.web }, state: { ...security.state }, minFreeBytes: security.minFreeBytes };
}

export async function preflightFixedRoots({ fs, galleryRoot, stateRoot, security, requiredBytes }) {
  const gallery = await canonicalDirectory(fs, galleryRoot, 'gallery root');
  const state = await canonicalDirectory(fs, stateRoot, 'state root');
  if (gallery.path === state.path || gallery.path.startsWith(`${state.path}${path.sep}`) || state.path.startsWith(`${gallery.path}${path.sep}`)) fail('gallery and state roots must be disjoint');
  assertMetadata(gallery.stat, security.web, 'gallery root', security.web.directoryMode);
  assertMetadata(state.stat, security.state, 'state root', security.state.directoryMode);
  if (gallery.stat.dev !== state.stat.dev) fail('gallery and state roots must use the same filesystem device');
  if (freeBytes(await fs.statfs(gallery.path)) < requiredBytes || freeBytes(await fs.statfs(state.path)) < requiredBytes) fail('insufficient free space for direct-file transaction');
  return { galleryRoot: gallery.path, stateRoot: state.path };
}

export async function assertTargetAbsent({ fs, executor, galleryRoot, slug = DIRECT_SLUG }) {
  const target = fixedTarget(galleryRoot, slug);
  if (await lstatOrNull(fs, target)) fail('fixed direct-file target already exists locally');
  const remote = await executor.lstat(target);
  if (!remote || remote.exists !== false) fail('remote lstat did not prove the fixed target absent');
  if (await executor.testAbsent(target) !== true) fail('remote test ! -e did not prove the fixed target absent');
  return target;
}

export async function assertExactTarget({ fs, target, security, expected }) {
  const stat = await assertRegularFile(fs, target, 'direct-file target');
  const metadata = assertMetadata(stat, security.web, 'direct-file target', security.web.fileMode);
  const bytes = Buffer.from(await fs.readFile(target));
  if (bytes.length !== expected.size || expected.sha256(bytes) !== expected.hash) fail('direct-file target identity does not match the synced journal');
  return { stat, metadata, bytes };
}

async function renameAt2(source, destination, flags) {
  const script = `import ctypes, os, platform, sys\nnums={'x86_64':316,'aarch64':276,'arm64':276}\nnum=nums.get(platform.machine().lower())\nif num is None: raise SystemExit('unsupported architecture')\nr=ctypes.CDLL(None,use_errno=True).syscall(num,-100,os.fsencode(sys.argv[1]),-100,os.fsencode(sys.argv[2]),int(sys.argv[3]))\nif r: e=ctypes.get_errno(); sys.stderr.write(f'renameat2-errno:{e}\\n'); raise SystemExit(1)`;
  try { await executeFile('python3', ['-c', script, source, destination, String(flags)], { maxBuffer: 1024 }); } catch (error) {
    const match = /^renameat2-errno:(\d+)\s*$/.exec(error?.stderr ?? '');
    if (match) {
      const code = Object.entries(osConstants.errno).find(([, value]) => value === Number(match[1]))?.[0] ?? 'ERENAMEAT2';
      const failure = new Error(`atomic rename failed: ${code}`); failure.code = code; throw failure;
    }
    throw error;
  }
}

function assertFilename(filename) {
  if (!['transaction.json', 'reviewed-direct-file.json', DIRECT_FILENAME].includes(filename)) {
    fail('direct-file write filename is outside the fixed state/target allowlist');
  }
}

export function createNodeFilesystem({ randomId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}` } = {}) {
  async function fsyncDirectory(directory) {
    const handle = await nodeOpen(directory, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
    try { await handle.sync(); } finally { await handle.close(); }
  }
  async function writeAtomic({ directory, filename, contents, mode, uid, gid, replace = false }) {
    assertAbsolutePath(directory, 'atomic write directory');
    assertFilename(filename);
    const target = childPath(directory, filename);
    if (!replace && await lstatOrNull(api, target)) fail('atomic no-replace target already exists');
    for (let attempt = 0; attempt < TEMP_ATTEMPTS; attempt += 1) {
      const temporary = childPath(directory, `.${filename}.${randomId()}.tmp`);
      let handle;
      try { handle = await nodeOpen(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, mode); } catch (error) { if (error.code === 'EEXIST') continue; throw error; }
      try { await handle.writeFile(contents); await nodeChown(temporary, uid, gid); await nodeChmod(temporary, mode); await handle.sync(); } finally { await handle.close(); }
      if (replace) await import('node:fs/promises').then(({ rename }) => rename(temporary, target)); else await api.renameNoReplace(temporary, target);
      await fsyncDirectory(directory);
      return target;
    }
    fail('could not allocate an atomic temporary file');
  }
  const api = {
    chmod: nodeChmod, chown: nodeChown, fsyncDirectory, lstat: nodeLstat, mkdir: nodeMkdir,
    readFile: nodeReadFile, realpath: nodeRealpath, renameNoReplace: (source, target) => renameAt2(source, target, 1),
    rm: nodeRm, statfs: nodeStatfs, writeAtomic,
  };
  return api;
}

export async function makeStateDirectory(fs, target, security) {
  await fs.mkdir(target, { recursive: false, mode: security.directoryMode });
  await fs.chown(target, security.uid, security.gid);
  await fs.chmod(target, security.directoryMode);
  await fs.fsyncDirectory(path.dirname(target));
  assertMetadata(await assertDirectory(fs, target, 'state directory'), security, 'state directory', security.directoryMode);
}

export async function ensureStateDirectory(fs, target, security) {
  const existing = await fs.lstat(target).catch((error) => { if (error?.code === 'ENOENT') return null; throw error; });
  if (existing === null) return makeStateDirectory(fs, target, security);
  if (!isDirectory(existing) || isSymlink(existing) || existing.uid !== security.uid || existing.gid !== security.gid || modeOf(existing) !== security.directoryMode) fail('existing state directory has unsafe identity');
  return target;
}

export async function writePrivateFile(fs, target, contents, security) {
  const filename = path.basename(target);
  assertFilename(filename);
  await fs.writeAtomic({ directory: path.dirname(target), filename, contents, mode: security.fileMode, uid: security.uid, gid: security.gid, replace: true });
  assertMetadata(await assertRegularFile(fs, target, 'private state file'), security, 'private state file', security.fileMode);
}

export async function syncJournal(fs, journalPath, journal, security, now = () => new Date()) {
  const date = now(); if (!(date instanceof Date) || Number.isNaN(date.valueOf())) fail('clock must return a valid date');
  journal.updatedAt = date.toISOString();
  await fs.writeAtomic({ directory: path.dirname(journalPath), filename: 'transaction.json', contents: `${JSON.stringify(journal, null, 2)}\n`, mode: security.fileMode, uid: security.uid, gid: security.gid, replace: true });
  assertMetadata(await assertRegularFile(fs, journalPath, 'transaction journal'), security, 'transaction journal', security.fileMode);
}

export async function setJournalPhase(fs, journalPath, journal, phase, security, now, phaseHook) {
  journal.phase = phase; journal.phases[phase] = now().toISOString();
  await syncJournal(fs, journalPath, journal, security, now);
  if (phaseHook) await phaseHook(phase, { ...journal });
}

export async function readJsonFile(fs, target, security, label = 'private state file') {
  const stat = await assertRegularFile(fs, target, label);
  assertMetadata(stat, security, label, security.fileMode);
  try { return JSON.parse((await fs.readFile(target)).toString('utf8')); } catch (error) { if (error instanceof SyntaxError) fail(`${label} is not valid JSON`); throw error; }
}

export function createLocalExecutor(fs = createNodeFilesystem()) {
  return {
    async lstat(target) { return { exists: (await lstatOrNull(fs, target)) !== null }; },
    async testAbsent(target) { return (await lstatOrNull(fs, target)) === null; },
  };
}

function assertKeyPathSyntax(keyFile) {
  assertAbsolutePath(keyFile, '--key-file');
  if (/-----BEGIN|[\r\n]/i.test(keyFile)) fail('--key-file accepts a path, never key material');
}

function secureKeyStat(stat) {
  if (!isFile(stat) || isSymlink(stat) || modeOf(stat) !== 0o600 || stat.uid !== process.getuid() || stat.gid !== process.getgid()) fail('--key-file must be a current-user-owned 0600 regular file');
}

export async function stageCliKeyFile(keyFile) {
  assertKeyPathSyntax(keyFile);
  await assertNoSymlinkComponents({ lstat: nodeLstat }, keyFile, '--key-file');
  const canonical = await nodeRealpath(keyFile); if (canonical !== keyFile) fail('--key-file must be canonical and non-symlinked');
  const observed = await nodeLstat(keyFile); secureKeyStat(observed);
  const source = await nodeOpen(keyFile, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  let directory;
  try {
    const stable = await source.stat(); secureKeyStat(stable);
    if (stable.dev !== observed.dev || stable.ino !== observed.ino) fail('--key-file changed before secure open');
    directory = await nodeMkdtemp(path.join(tmpdir(), 'heydex-direct-key-'));
    await nodeChmod(directory, 0o700);
    const staged = path.join(directory, 'key');
    const normalized = normalizePrivateKey(await source.readFile());
    const destination = await nodeOpen(staged, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
    try { await destination.writeFile(normalized); await nodeChmod(staged, 0o600); await destination.sync(); } finally { await destination.close(); }
    await fsyncNativeDirectory(directory);
    secureKeyStat(await nodeLstat(staged));
    try { await executeFile('ssh-keygen', ['-y', '-f', staged], { maxBuffer: 1024 }); } catch { fail('--key-file is not a valid SSH private key'); }
    return { keyFile: staged, async cleanup() { await nodeRm(staged, { force: true }); await nodeRmdir(directory); } };
  } catch (error) {
    if (directory) {
      await nodeRm(path.join(directory, 'key'), { force: true });
      await nodeRmdir(directory).catch((cleanupError) => { if (cleanupError?.code !== 'ENOENT') throw cleanupError; });
    }
    throw error;
  } finally { await source.close(); }
}

async function fsyncNativeDirectory(directory) {
  const handle = await nodeOpen(directory, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}

function normalizePrivateKey(value) {
  const text = Buffer.from(value).toString('utf8');
  if (text.includes('\0')) fail('--key-file contains unsafe key data');
  const match = /^\s*(-----BEGIN ((?:OPENSSH|RSA|EC|DSA)? ?PRIVATE KEY)-----)\s*([\s\S]*?)\s*(-----END ((?:OPENSSH|RSA|EC|DSA)? ?PRIVATE KEY)-----)\s*$/.exec(text);
  if (!match || match[2] !== match[5]) fail('--key-file must contain one PEM or OpenSSH private-key block');
  const body = match[3].replace(/\s/g, '');
  if (body.length < 32 || !/^[A-Za-z0-9+/=]+$/.test(body)) fail('--key-file has an invalid private-key body');
  return `${match[1]}\n${body.match(/.{1,70}/g).join('\n')}\n${match[4]}\n`;
}

export function assertSshTarget({ host, user }) {
  if (typeof host !== 'string' || !/^[A-Za-z0-9.-]+$/.test(host)) fail('SSH host is invalid');
  if (typeof user !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(user)) fail('SSH user is invalid');
  return { host, user };
}

export function createSshExecutor({ keyFile, host, user, run }) {
  assertKeyPathSyntax(keyFile);
  assertSshTarget({ host, user });
  if (typeof run !== 'function') fail('SSH executor requires a command runner');
  async function invoke(operation, remotePath) {
    assertAbsolutePath(remotePath, 'SSH remote path');
    const allowedTarget = remotePath === `/var/www/explainers/${DIRECT_FILENAME}`;
    if (!allowedTarget) fail('SSH path is outside the fixed direct-file allowlist');
    return run('ssh', ['-i', keyFile, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '--', `${user}@${host}`, 'heydex-explainer-publisher', operation, remotePath]);
  }
  return { lstat: (target) => invoke('lstat', target), testAbsent: (target) => invoke('test-absent', target) };
}

export async function loadSeams(modulePath, context) {
  assertAbsolutePath(modulePath, '--executor-module');
  const module = await import(pathToFileURL(modulePath).href);
  const factory = module.createPublisherSeams ?? module.default;
  if (typeof factory !== 'function') fail('executor module must export createPublisherSeams');
  const seams = await factory(context);
  assertFilesystem(seams.fs); assertExecutor(seams.executor);
  if (seams.postPublishVerifier !== undefined && typeof seams.postPublishVerifier !== 'function') fail('postPublishVerifier must be a function');
  if (seams.authenticatedVerifier !== undefined && typeof seams.authenticatedVerifier !== 'function') fail('authenticatedVerifier must be a function');
  return seams;
}

export const constants = {
  directSlug: DIRECT_SLUG,
  directFilename: DIRECT_FILENAME,
  galleryRoot: DIRECT_GALLERY_ROOT,
  stateRoot: DIRECT_STATE_ROOT,
};
