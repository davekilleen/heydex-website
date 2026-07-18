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
  rename as nodeRename,
  rmdir as nodeRmdir,
  rm as nodeRm,
  statfs as nodeStatfs,
} from 'node:fs/promises';
import { constants as osConstants, tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const executeFile = promisify(execFile);
const TRANSACTION_ID = /^[a-z0-9][a-z0-9-]{0,95}$/;
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

function fail(message) { throw new DirectFilePrimitiveError(message); }
function isMissing(error) { return error?.code === 'ENOENT'; }
function isSymlink(stat) { return typeof stat?.isSymbolicLink === 'function' && stat.isSymbolicLink(); }
function isFile(stat) { return typeof stat?.isFile === 'function' && stat.isFile(); }
function isDirectory(stat) { return typeof stat?.isDirectory === 'function' && stat.isDirectory(); }
function modeOf(stat) { return stat.mode & 0o777; }
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
}

export const constants = {
  directSlug: DIRECT_SLUG,
  directFilename: DIRECT_FILENAME,
  directUrl: 'https://heydex.ai/explainers/dex-brain-vault-capability-architecture.html',
  galleryRoot: DIRECT_GALLERY_ROOT,
  stateRoot: DIRECT_STATE_ROOT,
};

export function assertAbsolutePath(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value !== path.normalize(value) || value.includes('\0')) {
    fail(`${label} must be an absolute normalized path`);
  }
  return value;
}

export function assertFixedRemoteRoots(galleryRoot, stateRoot) {
  if (galleryRoot !== DIRECT_GALLERY_ROOT || stateRoot !== DIRECT_STATE_ROOT) fail('direct-file remote roots are fixed and cannot be overridden');
  return { galleryRoot: DIRECT_GALLERY_ROOT, stateRoot: DIRECT_STATE_ROOT };
}

export function assertSshTarget({ host, user }) {
  if (typeof host !== 'string' || !/^[A-Za-z0-9.-]+$/.test(host)) fail('SSH host is invalid');
  if (typeof user !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(user)) fail('SSH user is invalid');
  return { host, user };
}

function assertTransactionId(value) {
  if (typeof value !== 'string' || !TRANSACTION_ID.test(value)) fail('transactionId must be a lowercase hyphenated identifier');
  return value;
}

function childPath(root, ...segments) {
  const absolute = assertAbsolutePath(root, 'direct-file root');
  const target = path.resolve(absolute, ...segments);
  if (!target.startsWith(`${absolute}${path.sep}`)) fail('computed direct-file path escapes its configured root');
  return target;
}

export function fixedFilename(slug = DIRECT_SLUG) {
  if (slug !== DIRECT_SLUG) fail('direct-file slug is outside the authorized fixed target');
  return DIRECT_FILENAME;
}

export function fixedTarget(galleryRoot, slug = DIRECT_SLUG) { return childPath(galleryRoot, fixedFilename(slug)); }
export function transactionRoot(stateRoot, transactionId) { return childPath(childPath(stateRoot, 'transactions'), assertTransactionId(transactionId)); }
export function stagingTarget(stateRoot, transactionId, slug = DIRECT_SLUG) { return childPath(childPath(childPath(stateRoot, 'staging'), assertTransactionId(transactionId)), fixedFilename(slug)); }
export function quarantineTarget(stateRoot, transactionId, slug = DIRECT_SLUG) { return childPath(childPath(transactionRoot(stateRoot, transactionId), 'quarantine'), fixedFilename(slug)); }

export function transactionPaths(galleryRoot, stateRoot, transactionId, slug = DIRECT_SLUG) {
  const txRoot = transactionRoot(stateRoot, transactionId);
  const stagedTarget = stagingTarget(stateRoot, transactionId, slug);
  const quarantine = quarantineTarget(stateRoot, transactionId, slug);
  return {
    target: fixedTarget(galleryRoot, slug),
    transactionsRoot: childPath(stateRoot, 'transactions'),
    stagingRoot: childPath(stateRoot, 'staging'),
    transactionRoot: txRoot,
    journalPath: childPath(txRoot, 'transaction.json'),
    reviewedPath: childPath(txRoot, 'reviewed-direct-file.json'),
    stageDirectory: path.dirname(stagedTarget),
    stagedTarget,
    quarantineDirectory: path.dirname(quarantine),
    quarantineTarget: quarantine,
  };
}

export function fileIdentity(stat) {
  if (!stat || !Number.isInteger(stat.dev) || !Number.isInteger(stat.ino)) fail('file identity must include device and inode');
  return { device: stat.dev, inode: stat.ino };
}

export function sameFileIdentity(expected, actual) {
  return isPlainObject(expected) && Number.isInteger(expected.device) && Number.isInteger(expected.inode)
    && expected.device === actual?.device && expected.inode === actual?.inode;
}

export function assertFilesystem(fs) {
  for (const method of ['chmod', 'chown', 'fsyncDirectory', 'lstat', 'mkdir', 'readFile', 'realpath', 'renameNoReplace', 'rm', 'statfs', 'writeAtomic']) {
    if (typeof fs?.[method] !== 'function') fail(`filesystem seam is missing ${method}`);
  }
  return fs;
}

export function assertExecutor(executor) {
  for (const method of ['lstat', 'testAbsent']) if (typeof executor?.[method] !== 'function') fail(`executor seam is missing ${method}`);
  return executor;
}

export function normalizeSecurity(security) {
  if (!isPlainObject(security)) fail('security policy is required');
  const required = { web: { directoryMode: 0o755, fileMode: 0o644 }, state: { directoryMode: 0o700, fileMode: 0o600 } };
  for (const [area, modes] of Object.entries(required)) {
    const policy = security[area];
    if (!isPlainObject(policy) || !Number.isInteger(policy.uid) || !Number.isInteger(policy.gid)) fail(`security.${area} must declare uid and gid`);
    for (const [field, expected] of Object.entries(modes)) if (policy[field] !== expected) fail(`security.${area}.${field} must be ${expected.toString(8)}`);
  }
  if (!Number.isSafeInteger(security.minFreeBytes) || security.minFreeBytes < 0) fail('security.minFreeBytes must be a non-negative safe integer');
  return { web: { ...security.web }, state: { ...security.state }, minFreeBytes: security.minFreeBytes };
}

async function lstatOrNull(fs, target) {
  try { return await fs.lstat(target); } catch (error) { if (isMissing(error)) return null; throw error; }
}

function assertMetadata(stat, policy, mode, label) {
  if (!stat || stat.uid !== policy.uid || stat.gid !== policy.gid || modeOf(stat) !== mode) fail(`${label} owner, group, or mode does not match policy`);
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

export async function assertCanonicalDirectory(fs, target, { device, policy, label = 'directory' } = {}) {
  await assertNoSymlinkComponents(fs, target, label);
  const stat = await lstatOrNull(fs, target);
  if (stat === null || isSymlink(stat) || !isDirectory(stat)) fail(`${label} must be an existing real directory`);
  const real = await fs.realpath(target);
  if (real !== target) fail(`${label} must resolve exactly without symbolic links`);
  if (device !== undefined && stat.dev !== device) fail(`${label} must remain on the gallery filesystem device`);
  if (policy) assertMetadata(stat, policy, policy.directoryMode, label);
  return stat;
}

export async function assertSafePath(fs, target, { device, label = 'path', type, policy, allowAbsent = false } = {}) {
  await assertCanonicalDirectory(fs, path.dirname(target), { device, label: `${label} parent` });
  const stat = await lstatOrNull(fs, target);
  if (stat === null) {
    if (allowAbsent) return null;
    fail(`${label} must exist`);
  }
  if (isSymlink(stat)) fail(`${label} must not be a symbolic link`);
  if (type === 'directory' && !isDirectory(stat)) fail(`${label} must be a directory`);
  if (type === 'file' && !isFile(stat)) fail(`${label} must be a regular file`);
  const real = await fs.realpath(target);
  if (real !== target) fail(`${label} must resolve exactly without symbolic links`);
  if (device !== undefined && stat.dev !== device) fail(`${label} must remain on the gallery filesystem device`);
  if (policy) assertMetadata(stat, policy, type === 'directory' ? policy.directoryMode : policy.fileMode, label);
  return stat;
}

function freeBytes(value) {
  const bsize = Number(value?.bsize); const bavail = Number(value?.bavail);
  if (!Number.isSafeInteger(bsize) || !Number.isSafeInteger(bavail) || bsize < 1 || bavail < 0) fail('statfs returned invalid free-space metadata');
  const bytes = bsize * bavail;
  if (!Number.isSafeInteger(bytes)) fail('statfs free space exceeds safe integer range');
  return bytes;
}

export async function preflightFixedRoots({ fs, galleryRoot, stateRoot, security, requiredBytes }) {
  const gallery = await assertCanonicalDirectory(fs, galleryRoot, { policy: security.web, label: 'gallery root' });
  const state = await assertCanonicalDirectory(fs, stateRoot, { policy: security.state, label: 'state root' });
  if (gallery.dev !== state.dev) fail('gallery and state roots must use the same filesystem device');
  if (freeBytes(await fs.statfs(galleryRoot)) < requiredBytes || freeBytes(await fs.statfs(stateRoot)) < requiredBytes) fail('insufficient free space for direct-file transaction');
  return { galleryRoot, stateRoot, device: gallery.dev };
}

export async function assertTransactionPaths({ fs, roots, transactionId, security, requireTransaction = false, requireJournal = false, requireStage = false, requireStaged = false, requireTarget = false, requireQuarantine = false, requireQuarantined = false }) {
  const paths = transactionPaths(roots.galleryRoot, roots.stateRoot, transactionId);
  await assertCanonicalDirectory(fs, roots.galleryRoot, { device: roots.device, policy: security.web, label: 'gallery root' });
  await assertCanonicalDirectory(fs, roots.stateRoot, { device: roots.device, policy: security.state, label: 'state root' });
  await assertCanonicalDirectory(fs, paths.transactionsRoot, { device: roots.device, policy: security.state, label: 'transactions root' });
  await assertCanonicalDirectory(fs, paths.stagingRoot, { device: roots.device, policy: security.state, label: 'staging root' });
  const transaction = await assertSafePath(fs, paths.transactionRoot, { device: roots.device, policy: security.state, type: 'directory', label: 'transaction directory', allowAbsent: !requireTransaction });
  const stage = await assertSafePath(fs, paths.stageDirectory, { device: roots.device, policy: security.state, type: 'directory', label: 'staging directory', allowAbsent: !requireStage });
  const targetStat = await assertSafePath(fs, paths.target, { device: roots.device, policy: security.web, type: 'file', label: 'fixed target', allowAbsent: !requireTarget });
  let journal = null; let reviewed = null; let quarantineDirectoryStat = null; let quarantine = null;
  if (transaction) {
    journal = await assertSafePath(fs, paths.journalPath, { device: roots.device, policy: security.state, type: 'file', label: 'transaction journal', allowAbsent: !requireJournal });
    reviewed = await assertSafePath(fs, paths.reviewedPath, { device: roots.device, policy: security.state, type: 'file', label: 'reviewed receipt', allowAbsent: true });
    quarantineDirectoryStat = await assertSafePath(fs, paths.quarantineDirectory, { device: roots.device, policy: security.state, type: 'directory', label: 'quarantine directory', allowAbsent: !requireQuarantine });
    if (quarantineDirectoryStat) quarantine = await assertSafePath(fs, paths.quarantineTarget, { device: roots.device, policy: security.web, type: 'file', label: 'quarantined target', allowAbsent: !requireQuarantined });
  }
  let staged = null;
  if (stage) staged = await assertSafePath(fs, paths.stagedTarget, { device: roots.device, policy: security.web, type: 'file', label: 'staged target', allowAbsent: !requireStaged });
  return { ...paths, transaction, stage, targetStat, journal, reviewed, staged, quarantineDirectoryStat, quarantine };
}

export async function assertTargetAbsent({ fs, executor, galleryRoot, slug = DIRECT_SLUG }) {
  const target = fixedTarget(galleryRoot, slug);
  if (await lstatOrNull(fs, target)) fail('fixed direct-file target already exists locally');
  const remote = await executor.lstat(target);
  if (!remote || remote.exists !== false) fail('remote lstat did not prove the fixed target absent');
  if (await executor.testAbsent(target) !== true) fail('remote test ! -e did not prove the fixed target absent');
  return target;
}

export async function makeStateDirectory(fs, target, security, device) {
  await assertCanonicalDirectory(fs, path.dirname(target), { device, policy: security, label: 'state directory parent' });
  await fs.mkdir(target, { recursive: false, mode: security.directoryMode });
  await fs.chown(target, security.uid, security.gid);
  await fs.chmod(target, security.directoryMode);
  await fs.fsyncDirectory(path.dirname(target));
  await assertCanonicalDirectory(fs, target, { device, policy: security, label: 'state directory' });
}

export async function ensureStateDirectory(fs, target, security, device) {
  const existing = await lstatOrNull(fs, target);
  if (existing === null) return makeStateDirectory(fs, target, security, device);
  await assertCanonicalDirectory(fs, target, { device, policy: security, label: 'state directory' });
  return target;
}

export async function syncJournal(fs, journalPath, journal, security, now, device) {
  const date = now();
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) fail('clock must return a valid date');
  await assertCanonicalDirectory(fs, path.dirname(journalPath), { device, policy: security, label: 'journal parent' });
  journal.updatedAt = date.toISOString();
  await fs.writeAtomic({ directory: path.dirname(journalPath), filename: 'transaction.json', contents: `${JSON.stringify(journal, null, 2)}\n`, mode: security.fileMode, uid: security.uid, gid: security.gid, replace: true });
  await assertSafePath(fs, journalPath, { device, policy: security, type: 'file', label: 'transaction journal' });
}

export async function setJournalPhase(fs, journalPath, journal, phase, security, now, device, phaseHook) {
  journal.phase = phase;
  journal.phases[phase] = now().toISOString();
  await syncJournal(fs, journalPath, journal, security, now, device);
  if (phaseHook) await phaseHook(phase, { ...journal });
}

export async function readJsonFile(fs, target, security, device, label = 'private state file') {
  await assertSafePath(fs, target, { device, policy: security, type: 'file', label });
  try { return JSON.parse((await fs.readFile(target)).toString('utf8')); } catch (error) { if (error instanceof SyntaxError) fail(`${label} is not valid JSON`); throw error; }
}

async function renameAt2(source, destination, flags) {
  const script = `import ctypes,os,platform,sys\nnums={'x86_64':316,'aarch64':276,'arm64':276}\nn=nums.get(platform.machine().lower())\nif n is None: raise SystemExit('unsupported architecture')\nr=ctypes.CDLL(None,use_errno=True).syscall(n,-100,os.fsencode(sys.argv[1]),-100,os.fsencode(sys.argv[2]),int(sys.argv[3]))\nif r: e=ctypes.get_errno();sys.stderr.write(f'renameat2-errno:{e}\\n');raise SystemExit(1)`;
  try { await executeFile('python3', ['-c', script, source, destination, String(flags)], { maxBuffer: 1024 }); } catch (error) {
    const match = /^renameat2-errno:(\d+)\s*$/.exec(error?.stderr ?? '');
    if (match) {
      const code = Object.entries(osConstants.errno).find(([, value]) => value === Number(match[1]))?.[0] ?? 'ERENAMEAT2';
      const wrapped = new Error(`atomic rename failed: ${code}`); wrapped.code = code; throw wrapped;
    }
    throw error;
  }
}

function assertWriteFilename(filename) {
  if (!['transaction.json', 'reviewed-direct-file.json', DIRECT_FILENAME].includes(filename)) fail('direct-file write filename is outside the fixed state/target allowlist');
}

export function createNodeFilesystem({ randomId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}` } = {}) {
  async function fsyncDirectory(directory) {
    const handle = await nodeOpen(directory, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
    try { await handle.sync(); } finally { await handle.close(); }
  }
  async function writeAtomic({ directory, filename, contents, mode, uid, gid, replace = false }) {
    assertAbsolutePath(directory, 'atomic write directory');
    assertWriteFilename(filename);
    const target = childPath(directory, filename);
    if (!replace && await lstatOrNull(api, target)) fail('atomic no-replace target already exists');
    for (let attempt = 0; attempt < TEMP_ATTEMPTS; attempt += 1) {
      const temporary = childPath(directory, `.${filename}.${randomId()}.tmp`);
      let handle;
      try { handle = await nodeOpen(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, mode); } catch (error) { if (error.code === 'EEXIST') continue; throw error; }
      try { await handle.writeFile(contents); await nodeChown(temporary, uid, gid); await nodeChmod(temporary, mode); await handle.sync(); } finally { await handle.close(); }
      if (replace) await nodeRename(temporary, target); else await api.renameNoReplace(temporary, target);
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

function normalizePrivateKey(value) {
  const text = Buffer.from(value).toString('utf8');
  if (text.includes('\0')) fail('--key-file contains unsafe key data');
  const match = /^\s*(-----BEGIN ((?:OPENSSH|RSA|EC|DSA)? ?PRIVATE KEY)-----)\s*([\s\S]*?)\s*(-----END ((?:OPENSSH|RSA|EC|DSA)? ?PRIVATE KEY)-----)\s*$/.exec(text);
  if (!match || match[2] !== match[5]) fail('--key-file must contain one PEM or OpenSSH private-key block');
  const body = match[3].replace(/\s/g, '');
  if (body.length < 32 || !/^[A-Za-z0-9+/=]+$/.test(body)) fail('--key-file has an invalid private-key body');
  return `${match[1]}\n${body.match(/.{1,70}/g).join('\n')}\n${match[4]}\n`;
}

export async function stageCliKeyFile(keyFile) {
  assertKeyPathSyntax(keyFile);
  await assertNoSymlinkComponents({ lstat: nodeLstat }, keyFile, '--key-file');
  if (await nodeRealpath(keyFile) !== keyFile) fail('--key-file must be canonical and non-symlinked');
  const observed = await nodeLstat(keyFile); secureKeyStat(observed);
  const source = await nodeOpen(keyFile, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  let directory;
  try {
    const stable = await source.stat(); secureKeyStat(stable);
    if (stable.dev !== observed.dev || stable.ino !== observed.ino) fail('--key-file changed before secure open');
    directory = await nodeMkdtemp(path.join(tmpdir(), 'heydex-direct-key-'));
    await nodeChmod(directory, 0o700);
    const staged = path.join(directory, 'key');
    const destination = await nodeOpen(staged, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
    try { await destination.writeFile(normalizePrivateKey(await source.readFile())); await destination.sync(); } finally { await destination.close(); }
    secureKeyStat(await nodeLstat(staged));
    try { await executeFile('ssh-keygen', ['-y', '-f', staged], { maxBuffer: 1024 }); } catch { fail('--key-file is not a valid SSH private key'); }
    return { keyFile: staged, async cleanup() { await nodeRm(staged, { force: true }); await nodeRmdir(directory); } };
  } catch (error) {
    if (directory) { await nodeRm(path.join(directory, 'key'), { force: true }); await nodeRmdir(directory).catch(() => {}); }
    throw error;
  } finally { await source.close(); }
}
