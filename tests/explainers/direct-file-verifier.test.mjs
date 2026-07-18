import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { constants } from '../../scripts/explainers/direct-file-primitives.mjs';
import { createFixedDirectFileVerifier, DIRECT_FILE_OAUTH_GATE_URL, isFixedDirectFileOauthGateUrl } from '../../scripts/explainers/direct-file-verifier.mjs';

const NOW = '2026-07-18T12:00:00.000Z';
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

async function cookieJar() {
  const root = await mkdtemp('/var/tmp/heydex-direct-file-verifier-test-');
  const file = path.join(root, 'cookies.txt');
  await writeFile(file, '# Netscape HTTP Cookie File\nheydex.ai\tFALSE\t/\tTRUE\t0\tsession\ttest\n', { mode: 0o600 });
  await chmod(file, 0o600);
  return { root, file };
}

function promoted(body) {
  return {
    transactionId: 'fixed-verifier-transaction',
    verificationNonce: 'a'.repeat(64),
    promotedAt: NOW,
    url: constants.directUrl,
    artifactSha256: sha256(body),
    artifactSize: body.length,
    forbiddenStrings: ['private artifact marker'],
  };
}

function curlRunner({ privateBody, location = DIRECT_FILE_OAUTH_GATE_URL, calls }) {
  return async (command, args, options = {}) => {
    calls.push({ command, args, options });
    const headerPath = args[args.indexOf('--dump-header') + 1];
    const bodyPath = args[args.indexOf('--output') + 1];
    const authenticated = args.includes('--cookie');
    const status = authenticated ? 200 : 302;
    const headers = authenticated
      ? 'HTTP/2 200 OK\r\nx-robots-tag: noindex, nofollow, noarchive\r\n\r\n'
      : `HTTP/2 302 Found\r\nlocation: ${location}\r\n\r\n`;
    await writeFile(headerPath, headers);
    await writeFile(bodyPath, authenticated ? privateBody : 'oauth gate body');
    return { stdout: String(status), stderr: '' };
  };
}

test('fixed verifier runs only sealed curl checks for the exact URL and binds fresh evidence to the promoted nonce', async (t) => {
  const jar = await cookieJar();
  t.after(() => rm(jar.root, { recursive: true, force: true }));
  const body = Buffer.from('<!doctype html><main>private artifact marker</main>');
  const calls = [];
  const verifier = createFixedDirectFileVerifier({ cookieJar: jar.file, now: () => new Date(NOW), run: curlRunner({ privateBody: body, calls }) });
  const result = await verifier.verify(promoted(body));

  assert.equal(result.transactionId, 'fixed-verifier-transaction');
  assert.equal(result.verificationNonce, 'a'.repeat(64));
  assert.equal(result.promotedAt, NOW);
  assert.deepEqual(result.authenticated.requestUrls, [constants.directUrl]);
  assert.deepEqual(result.unauthenticated.requestUrls, [constants.directUrl]);
  assert.equal(result.unauthenticated.location, DIRECT_FILE_OAUTH_GATE_URL);
  assert.equal(calls.length, 2);
  for (const { command, args } of calls) {
    assert.equal(command, 'curl');
    assert.equal(args.at(-1), constants.directUrl);
    assert.deepEqual(args.slice(0, 13), ['--disable', '--noproxy', '*', '--silent', '--show-error', '--request', 'GET', '--proto', '=https', '--max-redirs', '0', '--connect-timeout', '10']);
    assert.doesNotMatch(args.join(' '), /--location|--remote-name|http:\/\//);
  }
  assert.equal(calls[0].args.includes('--cookie'), false);
  assert.equal(calls[1].args.at(calls[1].args.indexOf('--cookie') + 1), jar.file);
});

test('fixed OAuth gate accepts only the exact start redirect and canonical encoded rd', () => {
  assert.equal(DIRECT_FILE_OAUTH_GATE_URL, `https://heydex.ai/oauth2/start?rd=${constants.directUrl}`);
  assert.equal(isFixedDirectFileOauthGateUrl(DIRECT_FILE_OAUTH_GATE_URL), true);
  assert.equal(isFixedDirectFileOauthGateUrl(`https://heydex.ai/oauth2/start?rd=${encodeURIComponent(constants.directUrl)}`), true);
  for (const location of [
    'https://heydex.ai/oauth2/sign_in',
    'https://heydex.ai/oauth2/start?rd=https://heydex.ai/explainers/other.html',
    `${DIRECT_FILE_OAUTH_GATE_URL}&extra=value`,
    `https://attacker.test/oauth2/start?rd=${constants.directUrl}`,
  ]) assert.equal(isFixedDirectFileOauthGateUrl(location), false);
});

test('fixed verifier rejects sign-in, wrong rd, and extra-query OAuth redirects before emitting finalization evidence', async (t) => {
  const jar = await cookieJar();
  t.after(() => rm(jar.root, { recursive: true, force: true }));
  const body = Buffer.from('<!doctype html><main>private artifact marker</main>');
  for (const location of [
    'https://heydex.ai/oauth2/sign_in',
    'https://heydex.ai/oauth2/start?rd=https://heydex.ai/explainers/other.html',
    `${DIRECT_FILE_OAUTH_GATE_URL}&extra=value`,
  ]) {
    const verifier = createFixedDirectFileVerifier({
      cookieJar: jar.file,
      now: () => new Date(NOW),
      run: curlRunner({ privateBody: body, location, calls: [] }),
    });
    await assert.rejects(() => verifier.verify(promoted(body)), /expected gate/);
  }
});

test('fixed verifier disables hostile curl config and clears every proxy variable while retaining only the fixed URL', async (t) => {
  const jar = await cookieJar();
  const hostileHome = path.join(jar.root, 'hostile-home');
  await mkdir(hostileHome, { mode: 0o700 });
  await writeFile(path.join(hostileHome, '.curlrc'), 'url = https://attacker.test/extra\nproxy = http://attacker.test:8080\nheader = X-Attacker: enabled\n', { mode: 0o600 });
  t.after(() => rm(jar.root, { recursive: true, force: true }));
  const body = Buffer.from('<!doctype html><main>private artifact marker</main>');
  const calls = [];
  const environment = {
    PATH: process.env.PATH,
    HOME: hostileHome,
    HTTP_PROXY: 'http://attacker.test:8080',
    HTTPS_PROXY: 'http://attacker.test:8080',
    ALL_PROXY: 'http://attacker.test:8080',
    NO_PROXY: 'attacker.test',
    http_proxy: 'http://attacker.test:8080',
    https_proxy: 'http://attacker.test:8080',
    all_proxy: 'http://attacker.test:8080',
  };
  const verifier = createFixedDirectFileVerifier({
    cookieJar: jar.file,
    now: () => new Date(NOW),
    environment,
    run: curlRunner({ privateBody: body, calls }),
  });
  await verifier.verify(promoted(body));

  assert.equal(calls.length, 2);
  for (const { command, args, options } of calls) {
    assert.equal(command, 'curl');
    assert.equal(args[0], '--disable');
    assert.deepEqual(args.slice(0, 3), ['--disable', '--noproxy', '*']);
    assert.equal(args.at(-1), constants.directUrl);
    assert.doesNotMatch(args.join('\u0000'), /attacker\.test|--config|--proxy/);
    assert.equal(options.env.HOME, hostileHome);
    assert.equal(Object.keys(options.env).some((key) => /_proxy$/i.test(key)), false);
  }
});
