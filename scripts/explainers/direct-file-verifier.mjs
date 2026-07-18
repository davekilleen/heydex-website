import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { constants } from './direct-file-primitives.mjs';

export const DIRECT_FILE_OAUTH_GATE_URL = 'https://heydex.ai/oauth2/sign_in';
const SHA256 = /^[a-f0-9]{64}$/;
const NONCE = /^[a-f0-9]{64}$/;
const MAX_COOKIE_JAR_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export class DirectFileVerifierError extends Error {
  constructor(message, options) { super(message, options); this.name = 'DirectFileVerifierError'; }
}

function fail(message) { throw new DirectFileVerifierError(message); }
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function validTime(value, label) {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) fail(`${label} must be a valid time`);
  return value;
}
function canonicalTime(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) fail(`${label} must be canonical UTC ISO-8601`);
  return new Date(value);
}
function assertVerifierInput(value) {
  if (!value || value.url !== constants.directUrl || typeof value.transactionId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,95}$/.test(value.transactionId) || typeof value.verificationNonce !== 'string' || !NONCE.test(value.verificationNonce) || !SHA256.test(value.artifactSha256) || !Number.isSafeInteger(value.artifactSize) || value.artifactSize < 1 || !Array.isArray(value.forbiddenStrings) || value.forbiddenStrings.some((marker) => typeof marker !== 'string' || marker.trim() === '')) fail('fixed verifier received an invalid promoted transaction');
  canonicalTime(value.promotedAt, 'promotedAt');
  return value;
}

async function assertCookieJar(cookieJar) {
  if (typeof cookieJar !== 'string' || !path.isAbsolute(cookieJar) || cookieJar !== path.normalize(cookieJar) || cookieJar.includes('\0')) fail('cookie jar must be an absolute normalized path');
  let stat;
  try { stat = await lstat(cookieJar); } catch { fail('cookie jar must be an existing private regular file'); }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600 || stat.size > MAX_COOKIE_JAR_BYTES) fail('cookie jar must be a current-user-owned 0600 regular file');
  return cookieJar;
}

function defaultRun(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = []; const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
      else reject(new DirectFileVerifierError(`fixed curl verifier failed (${code})`));
    });
  });
}

function parseHeaders(bytes) {
  const sections = bytes.toString('latin1').split(/\r?\n\r?\n/).filter((section) => /^HTTP\/\d(?:\.\d)?\s+\d{3}\b/.test(section));
  const final = sections.at(-1);
  if (!final) fail('fixed curl verifier returned malformed response headers');
  const lines = final.split(/\r?\n/);
  const status = Number(/^HTTP\/\d(?:\.\d)?\s+(\d{3})\b/.exec(lines.shift())?.[1]);
  if (!Number.isInteger(status)) fail('fixed curl verifier returned malformed HTTP status');
  const headers = {};
  for (const line of lines) {
    if (line === '') continue;
    const separator = line.indexOf(':');
    if (separator < 1 || /^\s/.test(line)) fail('fixed curl verifier returned malformed HTTP headers');
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    (headers[name] ??= []).push(value);
  }
  return { status, headers };
}

function header(response, name) {
  const values = response.headers?.[name.toLowerCase()];
  if (!Array.isArray(values) || values.length !== 1 || typeof values[0] !== 'string') return null;
  return values[0];
}

async function curlResponse({ authenticated, cookieJar, run }) {
  const directory = await mkdtemp('/var/tmp/heydex-direct-file-verifier-');
  const headersPath = path.join(directory, 'headers');
  const bodyPath = path.join(directory, 'body');
  try {
    const args = ['--silent', '--show-error', '--request', 'GET', '--proto', '=https', '--max-redirs', '0', '--connect-timeout', '10', '--max-time', '30', '--dump-header', headersPath, '--output', bodyPath, '--write-out', '%{http_code}'];
    if (authenticated) args.push('--cookie', cookieJar);
    args.push(constants.directUrl);
    const result = await run('curl', args);
    if (!result || typeof result.stdout !== 'string' || !/^\d{3}$/.test(result.stdout.trim())) fail('fixed curl verifier returned an invalid status result');
    const [headers, body] = await Promise.all([readFile(headersPath), readFile(bodyPath)]);
    if (body.length > MAX_RESPONSE_BYTES) fail('fixed curl verifier response exceeded the fixed size limit');
    const response = { ...parseHeaders(headers), body };
    if (response.status !== Number(result.stdout.trim())) fail('fixed curl verifier status disagrees with response headers');
    return response;
  } finally {
    await Promise.all([unlink(headersPath).catch(() => {}), unlink(bodyPath).catch(() => {})]);
    await rmdir(directory).catch(() => {});
  }
}

function responseEvidence(response, { authenticated, artifactSha256, artifactSize, forbiddenStrings }) {
  if (!response || !Number.isInteger(response.status) || !Buffer.isBuffer(response.body)) fail('fixed verifier response is malformed');
  const bodySha256 = hash(response.body);
  if (authenticated) {
    if (response.status !== 200 || response.body.length !== artifactSize || bodySha256 !== artifactSha256 || header(response, 'x-robots-tag') !== 'noindex, nofollow, noarchive') fail('authenticated fixed verifier response does not match the exact private artifact');
    return { status: response.status, bodySha256, bodySize: response.body.length, xRobotsTag: 'noindex, nofollow, noarchive', requestUrls: [constants.directUrl] };
  }
  if (![302, 303, 307, 308].includes(response.status) || header(response, 'location') !== DIRECT_FILE_OAUTH_GATE_URL || bodySha256 === artifactSha256 || forbiddenStrings.some((marker) => response.body.toString('utf8').includes(marker))) fail('unauthenticated fixed verifier response does not prove the expected gate and no private body');
  return { status: response.status, bodySha256, artifactLeaked: false, requestUrls: [constants.directUrl], location: DIRECT_FILE_OAUTH_GATE_URL };
}

/** The only network verifier: curl is fixed to one HTTPS URL and never follows redirects. */
export function createFixedDirectFileVerifier({ cookieJar, now = () => new Date(), run = defaultRun } = {}) {
  if (typeof run !== 'function') fail('fixed curl verifier runner must be a function');
  return {
    async verify(input) {
      const promoted = assertVerifierInput(input);
      const validCookieJar = await assertCookieJar(cookieJar);
      const unauthenticated = responseEvidence(await curlResponse({ authenticated: false, cookieJar: validCookieJar, run }), { ...promoted, authenticated: false });
      const authenticated = responseEvidence(await curlResponse({ authenticated: true, cookieJar: validCookieJar, run }), { ...promoted, authenticated: true });
      return {
        schemaVersion: 1,
        kind: 'direct-file-finalization',
        transactionId: promoted.transactionId,
        verificationNonce: promoted.verificationNonce,
        promotedAt: promoted.promotedAt,
        url: constants.directUrl,
        artifactSha256: promoted.artifactSha256,
        artifactSize: promoted.artifactSize,
        capturedAt: validTime(now(), 'fixed verifier clock').toISOString(),
        authenticated,
        unauthenticated,
      };
    },
  };
}
