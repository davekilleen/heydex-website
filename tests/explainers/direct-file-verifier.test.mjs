import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { constants } from '../../scripts/explainers/direct-file-primitives.mjs';
import { createFixedDirectFileVerifier, DIRECT_FILE_OAUTH_GATE_URL } from '../../scripts/explainers/direct-file-verifier.mjs';

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
  return async (command, args) => {
    calls.push({ command, args });
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
    assert.deepEqual(args.slice(0, 10), ['--silent', '--show-error', '--request', 'GET', '--proto', '=https', '--max-redirs', '0', '--connect-timeout', '10']);
    assert.doesNotMatch(args.join(' '), /--location|--remote-name|http:\/\//);
  }
  assert.equal(calls[0].args.includes('--cookie'), false);
  assert.equal(calls[1].args.at(calls[1].args.indexOf('--cookie') + 1), jar.file);
});

test('fixed verifier rejects a wrong OAuth redirect before emitting finalization evidence', async (t) => {
  const jar = await cookieJar();
  t.after(() => rm(jar.root, { recursive: true, force: true }));
  const body = Buffer.from('<!doctype html><main>private artifact marker</main>');
  const verifier = createFixedDirectFileVerifier({
    cookieJar: jar.file,
    now: () => new Date(NOW),
    run: curlRunner({ privateBody: body, location: 'https://attacker.test/oauth2/sign_in', calls: [] }),
  });
  await assert.rejects(() => verifier.verify(promoted(body)), /expected gate/);
});
