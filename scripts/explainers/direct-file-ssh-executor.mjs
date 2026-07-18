import { spawn } from 'node:child_process';

import {
  DirectFilePrimitiveError,
  assertSshTarget,
  constants,
} from './direct-file-primitives.mjs';

const ID = '[a-z0-9][a-z0-9-]{0,95}';
const FILE = constants.directFilename.replace('.', '\\.');
const STATE = constants.stateRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const STAGE_FILE = new RegExp(`^${STATE}/staging/(${ID})/${FILE}$`);
const QUARANTINE_FILE = new RegExp(`^${STATE}/transactions/(${ID})/quarantine/${FILE}$`);
const TRANSACTION_DIR = new RegExp(`^${STATE}/transactions/${ID}$`);
const STAGING_DIR = new RegExp(`^${STATE}/staging/${ID}$`);
const QUARANTINE_DIR = new RegExp(`^${STATE}/transactions/${ID}/quarantine$`);

function fail(message) { throw new DirectFilePrimitiveError(message); }
function quote(value) { return `'${String(value).replace(/'/g, "'\\''")}'`; }
function octal(mode) { if (!Number.isInteger(mode)) fail('remote mode must be an integer'); return mode.toString(8); }
function typeMethods(type) {
  return {
    isFile: () => type === 'file',
    isDirectory: () => type === 'directory',
    isSymbolicLink: () => type === 'symlink',
  };
}

function isStatePath(target) {
  return target === constants.stateRoot || target === `${constants.stateRoot}/transactions` || target === `${constants.stateRoot}/staging`
    || TRANSACTION_DIR.test(target) || STAGING_DIR.test(target) || QUARANTINE_DIR.test(target)
    || /^\/var\/www$/.test(target) || target === '/var';
}

function isMutableStateDirectory(target) {
  return target === `${constants.stateRoot}/transactions` || target === `${constants.stateRoot}/staging`
    || TRANSACTION_DIR.test(target) || STAGING_DIR.test(target) || QUARANTINE_DIR.test(target);
}

function isFilePath(target) {
  return target === `${constants.galleryRoot}/${constants.directFilename}`
    || STAGE_FILE.test(target) || QUARANTINE_FILE.test(target)
    || new RegExp(`^${STATE}/transactions/${ID}/(?:transaction|reviewed-direct-file)\\.json$`).test(target);
}

function assertReadablePath(target) {
  if (typeof target !== 'string' || (!isStatePath(target) && !isFilePath(target) && target !== constants.galleryRoot && target !== '/')) fail('SSH path is outside the fixed direct-file allowlist');
  return target;
}

function assertDirectoryPath(target) {
  assertReadablePath(target);
  if (!(target === constants.galleryRoot || target === constants.stateRoot || isMutableStateDirectory(target))) fail('SSH directory operation is outside the fixed direct-file allowlist');
  return target;
}

function assertMutableMetadataPath(target) {
  assertReadablePath(target);
  if (!isFilePath(target) && !isMutableStateDirectory(target)) fail('SSH metadata operation is outside the fixed direct-file allowlist');
  return target;
}

function assertWritableFile(directory, filename) {
  const target = `${directory}/${filename}`;
  if (!isFilePath(target) || target === `${constants.galleryRoot}/${constants.directFilename}` || QUARANTINE_FILE.test(target)) fail('SSH write is outside the transaction-private direct-file allowlist');
  return target;
}

function assertRename(source, target) {
  const staged = STAGE_FILE.exec(source);
  const quarantined = QUARANTINE_FILE.exec(target);
  const publishes = staged && target === `${constants.galleryRoot}/${constants.directFilename}`;
  const quarantines = source === `${constants.galleryRoot}/${constants.directFilename}` && quarantined;
  if (!publishes && !quarantines) fail('SSH rename is outside the fixed direct-file allowlist');
  return { source, target };
}

function assertRemove(target) {
  if (!STAGE_FILE.test(target) && !QUARANTINE_FILE.test(target)) fail('SSH removal is outside the fixed direct-file allowlist');
  return target;
}

const REMOTE_HELPER = String.raw`
set -eu
op=$1
shift
py_lstat='import json,os,stat,sys
p=sys.argv[1]
try:
 s=os.lstat(p); t="file" if stat.S_ISREG(s.st_mode) else "directory" if stat.S_ISDIR(s.st_mode) else "symlink" if stat.S_ISLNK(s.st_mode) else "other"; print(json.dumps({"exists":True,"type":t,"dev":s.st_dev,"ino":s.st_ino,"uid":s.st_uid,"gid":s.st_gid,"mode":s.st_mode & 511}))
except FileNotFoundError: print(json.dumps({"exists":False}))'
py_fsync='import os,sys
fd=os.open(sys.argv[1],os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
os.fsync(fd);os.close(fd)'
py_read='import base64,os,stat,sys
p=sys.argv[1]; s=os.lstat(p)
if not stat.S_ISREG(s.st_mode): raise SystemExit("refusing non-regular read")
fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
try:
 stable=os.fstat(fd)
 if stable.st_dev!=s.st_dev or stable.st_ino!=s.st_ino or not stat.S_ISREG(stable.st_mode): raise SystemExit("read identity changed")
 out=[]
 while True:
  chunk=os.read(fd,1048576)
  if not chunk: break
  out.append(chunk)
 sys.stdout.write(base64.b64encode(b"".join(out)).decode("ascii"))
finally: os.close(fd)'
py_rename='import ctypes,errno,os,platform,sys
nums={"x86_64":316,"aarch64":276,"arm64":276};n=nums.get(platform.machine().lower())
if n is None: raise SystemExit("unsupported architecture")
r=ctypes.CDLL(None,use_errno=True).syscall(n,-100,os.fsencode(sys.argv[1]),-100,os.fsencode(sys.argv[2]),1)
if r: raise OSError(ctypes.get_errno(),"renameat2")'
py_write='import ctypes,os,platform,secrets,sys
folder,name,mode,uid,gid,replace=sys.argv[1:7];d=os.open(folder,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);tmp="."+name+"."+secrets.token_hex(12)+".tmp"
fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,int(mode,8),dir_fd=d)
try:
 data=sys.stdin.buffer.read(); offset=0
 while offset < len(data): offset += os.write(fd,data[offset:])
 os.fchown(fd,int(uid),int(gid)); os.fchmod(fd,int(mode,8)); os.fsync(fd)
finally: os.close(fd)
try:
 if replace=="true": os.replace(tmp,name,src_dir_fd=d,dst_dir_fd=d)
 else:
  nums={"x86_64":316,"aarch64":276,"arm64":276};n=nums.get(platform.machine().lower())
  if n is None: raise SystemExit("unsupported architecture")
  r=ctypes.CDLL(None,use_errno=True).syscall(n,d,os.fsencode(tmp),d,os.fsencode(name),1)
  if r: raise OSError(ctypes.get_errno(),"renameat2")
 os.fsync(d)
finally:
 try: os.unlink(tmp,dir_fd=d)
 except FileNotFoundError: pass
 os.close(d)'
py_remove='import os,stat,sys
s=os.lstat(sys.argv[1])
if not stat.S_ISREG(s.st_mode): raise SystemExit("refusing non-regular removal")
os.unlink(sys.argv[1])'
py_allow='import re,sys
op,*args=sys.argv[1:]
root="/var/www/explainers"; state="/var/www/.heydex-explainer-publisher"; name="dex-brain-vault-capability-architecture.html"; target=root+"/"+name; ident=r"[a-z0-9][a-z0-9-]{0,95}"
def tx(p): return re.fullmatch(re.escape(state)+r"/transactions/"+ident,p) is not None
def stage(p): return re.fullmatch(re.escape(state)+r"/staging/"+ident,p) is not None
def quarantine(p): return re.fullmatch(re.escape(state)+r"/transactions/"+ident+r"/quarantine",p) is not None
def staged_file(p): return re.fullmatch(re.escape(state)+r"/staging/"+ident+r"/"+re.escape(name),p) is not None
def quarantine_file(p): return re.fullmatch(re.escape(state)+r"/transactions/"+ident+r"/quarantine/"+re.escape(name),p) is not None
def state_file(p): return re.fullmatch(re.escape(state)+r"/transactions/"+ident+r"/(transaction|reviewed-direct-file)\.json",p) is not None
def file_path(p): return p==target or staged_file(p) or quarantine_file(p) or state_file(p)
def mutable_directory(p): return p in (state+"/transactions",state+"/staging") or tx(p) or stage(p) or quarantine(p)
def readable(p): return p in ("/","/var","/var/www",root,state,state+"/transactions",state+"/staging") or mutable_directory(p) or file_path(p)
def mode(value): return value in ("600","644","700")
def fail(): raise SystemExit("fixed direct-file allowlist violation")
if op in ("lstat","realpath"):
 if len(args)!=1 or not readable(args[0]): fail()
elif op=="read-file":
 if len(args)!=1 or not file_path(args[0]): fail()
elif op=="test-absent":
 if args!=[target]: fail()
elif op=="statfs":
 if len(args)!=1 or args[0] not in (root,state): fail()
elif op=="mkdir":
 if len(args)!=2 or not mutable_directory(args[0]) or args[1]!="700": fail()
elif op=="chmod":
 if len(args)!=2 or not (file_path(args[0]) or mutable_directory(args[0])) or not mode(args[1]): fail()
elif op=="chown":
 if len(args)!=3 or not (file_path(args[0]) or mutable_directory(args[0])) or not args[1].isdigit() or not args[2].isdigit(): fail()
elif op=="fsync-directory":
 if len(args)!=1 or not (args[0] in (root,state) or mutable_directory(args[0])): fail()
elif op=="write-atomic":
 if len(args)!=6 or not args[2].isdigit() or not args[3].isdigit() or not args[4].isdigit() or args[5] not in ("true","false"): fail()
 directory,filename,mode_value,uid,gid,replace=args
 if directory and stage(directory) and filename==name and mode_value=="644" and replace=="false": pass
 elif directory and tx(directory) and filename in ("transaction.json","reviewed-direct-file.json") and mode_value=="600": pass
 else: fail()
elif op=="rename-no-replace":
 if len(args)!=2 or not ((staged_file(args[0]) and args[1]==target) or (args[0]==target and quarantine_file(args[1]))): fail()
elif op=="remove-file":
 if len(args)!=1 or not (staged_file(args[0]) or quarantine_file(args[0])): fail()
else: fail()'
python3 -c "$py_allow" "$op" "$@"
case "$op" in
 lstat) exec python3 -c "$py_lstat" "$1" ;;
 test-absent) [ ! -e "$1" ] && [ ! -L "$1" ] ;;
 realpath) exec python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1" ;;
 read-file) exec python3 -c "$py_read" "$1" ;;
 statfs) exec python3 -c 'import os,sys; s=os.statvfs(sys.argv[1]); print(f"{s.f_frsize} {s.f_bavail}")' "$1" ;;
 mkdir) exec mkdir -m "$2" -- "$1" ;;
 chmod) exec chmod "$2" -- "$1" ;;
 chown) exec chown "$2:$3" -- "$1" ;;
 fsync-directory) exec python3 -c "$py_fsync" "$1" ;;
 write-atomic) exec python3 -c "$py_write" "$@" ;;
 rename-no-replace) exec python3 -c "$py_rename" "$1" "$2" ;;
 remove-file) python3 -c "$py_remove" "$1"; exec python3 -c "$py_fsync" "$(dirname -- "$1")" ;;
 *) exit 64 ;;
esac`;

function defaultRun(command, args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    const stdout = []; const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
      else { const error = new Error(`fixed SSH helper failed (${code})`); error.code = `SSH_${code}`; reject(error); }
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

/**
 * The only production seam: a fixed, reviewed helper sent over SSH. Its local
 * allowlist and remote helper both accept only the audited roots and one slug.
 */
export function createFixedSshSeams({ keyFile, host, user, run = defaultRun }) {
  assertSshTarget({ host, user });
  if (typeof keyFile !== 'string' || !keyFile.startsWith('/')) fail('SSH key must be an absolute staged key path');
  if (typeof run !== 'function') fail('SSH runner must be a function');
  async function invoke(operation, args = [], options = {}) {
    const command = ['sh', '-ceu', quote(REMOTE_HELPER), 'heydex-direct-file-publisher', quote(operation), ...args.map(quote)].join(' ');
    return run('ssh', ['-i', keyFile, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '--', `${user}@${host}`, command], options);
  }
  async function lstat(target) {
    assertReadablePath(target);
    const { stdout } = await invoke('lstat', [target]);
    let parsed;
    try { parsed = JSON.parse(stdout); } catch { fail('fixed SSH helper returned invalid lstat data'); }
    if (parsed?.exists === false) { const error = new Error('not found'); error.code = 'ENOENT'; throw error; }
    if (!parsed || parsed.exists !== true || !['file', 'directory', 'symlink', 'other'].includes(parsed.type) || !Number.isInteger(parsed.dev) || !Number.isInteger(parsed.ino)) fail('fixed SSH helper returned unsafe lstat data');
    return { ...parsed, ...typeMethods(parsed.type) };
  }
  const fs = {
    lstat,
    async realpath(target) { assertReadablePath(target); return (await invoke('realpath', [target])).stdout.trim(); },
    async statfs(target) {
      if (![constants.galleryRoot, constants.stateRoot].includes(target)) fail('SSH statfs is outside the fixed direct-file allowlist');
      const [bsize, bavail] = (await invoke('statfs', [target])).stdout.trim().split(/\s+/).map(Number);
      return { bsize, bavail };
    },
    async mkdir(target, options = {}) { assertDirectoryPath(target); await invoke('mkdir', [target, octal(options.mode ?? 0o700)]); },
    async chmod(target, mode) { assertMutableMetadataPath(target); await invoke('chmod', [target, octal(mode)]); },
    async chown(target, uid, gid) { assertMutableMetadataPath(target); if (!Number.isInteger(uid) || !Number.isInteger(gid)) fail('SSH ownership is invalid'); await invoke('chown', [target, String(uid), String(gid)]); },
    async fsyncDirectory(target) { assertDirectoryPath(target); await invoke('fsync-directory', [target]); },
    async readFile(target) { assertReadablePath(target); return Buffer.from((await invoke('read-file', [target])).stdout, 'base64'); },
    async writeAtomic({ directory, filename, contents, mode, uid, gid, replace = false }) {
      assertWritableFile(directory, filename);
      if (!Number.isInteger(uid) || !Number.isInteger(gid)) fail('SSH ownership is invalid');
      await invoke('write-atomic', [directory, filename, octal(mode), String(uid), String(gid), String(replace)], { input: Buffer.from(contents) });
    },
    async renameNoReplace(source, target) { assertRename(source, target); await invoke('rename-no-replace', [source, target]); },
    async rm(target) { assertRemove(target); await invoke('remove-file', [target]); },
  };
  const executor = {
    async lstat(target) {
      try { await lstat(target); return { exists: true }; } catch (error) { if (error?.code === 'ENOENT') return { exists: false }; throw error; }
    },
    async testAbsent(target) {
      if (target !== `${constants.galleryRoot}/${constants.directFilename}`) fail('SSH absence probe is outside the fixed direct-file allowlist');
      try { await invoke('test-absent', [target]); return true; } catch { return false; }
    },
  };
  return { fs, executor };
}
