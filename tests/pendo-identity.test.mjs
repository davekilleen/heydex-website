import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import { setImmediate as waitForImmediate } from 'node:timers/promises';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const NEW_KEY = '1e3102e2-f668-41fc-8fca-aaae7e2c2d3b';
const OLD_KEY = 'c23ee23e-f3e6-4a1f-81a8-d19a3a85fe2b';
const BLOCK_COMMENT = '<!-- Pendo Analytics: unified web + desktop identity -->';

const instrumentedPages = new Map([
  ['index.html', 'heydex-website'],
  ['index-landing.html', 'heydex-website'],
  ['diff/community/index.html', 'heydex-dexdiff'],
  ['diff/love-letters/index.html', 'heydex-dexdiff'],
  ['diff/roadmap/index.html', 'heydex-dexdiff'],
  ['diff/welcome/index.html', 'heydex-dexdiff'],
  ['diff/admin/index.html', 'heydex-dexdiff'],
  ['diff/like-dave/index.html', 'heydex-dexdiff'],
  ['legal/privacy.html', 'heydex-website'],
  ['legal/terms.html', 'heydex-website'],
  ['install/index.html', 'heydex-website'],
]);

function source(path) {
  return readFileSync(new URL(path, ROOT), 'utf8');
}

function occurrences(value, needle) {
  return value.split(needle).length - 1;
}

function pendoScript(path) {
  const html = source(path);
  const commentStart = html.indexOf(BLOCK_COMMENT);
  assert.notEqual(commentStart, -1, `${path} has the canonical Pendo comment`);

  const scriptStart = html.indexOf('<script>', commentStart);
  const scriptEnd = html.indexOf('</script>', scriptStart);
  assert.notEqual(scriptStart, -1, `${path} has a Pendo script start`);
  assert.notEqual(scriptEnd, -1, `${path} has a Pendo script end`);
  return html.slice(scriptStart + '<script>'.length, scriptEnd);
}

function normalizedPendoScript(path) {
  return pendoScript(path).replace(
    /var ACCOUNT = '[^']+';/,
    "var ACCOUNT = '<ACCOUNT>';",
  );
}

function fakeDocument() {
  const insertedScripts = [];
  const firstScript = {
    parentNode: {
      insertBefore(script) {
        insertedScripts.push(script);
      },
    },
  };

  return {
    insertedScripts,
    createElement(tagName) {
      return { tagName };
    },
    getElementsByTagName() {
      return [firstScript];
    },
  };
}

function mapStorage(values = new Map()) {
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

async function runPendoScript({
  path = 'index.html',
  responses = [],
  storage = mapStorage(),
  crypto = { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
  math = Math,
  pendo,
} = {}) {
  const calls = [];
  const document = fakeDocument();
  const window = { crypto };
  if (pendo) window.pendo = pendo;

  const context = vm.createContext({
    document,
    fetch: async (url, options) => {
      calls.push({ url, options: structuredClone(options) });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next ?? { ok: false, json: async () => ({}) };
    },
    localStorage: storage,
    Math: math,
    window,
  });

  vm.runInContext(pendoScript(path), context);
  await waitForImmediate();
  await waitForImmediate();

  const queue = window.pendo?._q ?? [];
  return {
    calls,
    document,
    initializeCalls: queue
      .filter(([method]) => method === 'initialize')
      .map(([method, options]) => [method, structuredClone(options)]),
    storage,
    window,
  };
}

function okJson(value) {
  return { ok: true, json: async () => value };
}

function unauthorized() {
  return { ok: false, json: async () => ({}) };
}

test('every deployable named page uses one canonical Pendo initialization block', () => {
  const [canonicalPath] = instrumentedPages.keys();
  const canonicalScript = normalizedPendoScript(canonicalPath);

  for (const [path, account] of instrumentedPages) {
    const html = source(path);
    assert.equal(occurrences(html, BLOCK_COMMENT), 1, `${path} comment count`);
    assert.equal(occurrences(html, NEW_KEY), 1, `${path} new key count`);
    assert.equal(occurrences(html, OLD_KEY), 0, `${path} old key count`);
    assert.equal(occurrences(html, 'pendo.initialize('), 1, `${path} initialize count`);
    assert.match(html, new RegExp(`var ACCOUNT = '${account}';`));
    assert.equal(normalizedPendoScript(path), canonicalScript, `${path} canonical block`);
  }
});

test('the retired static company file stays absent because the SPA owns /diff/company', () => {
  assert.equal(existsSync(new URL('diff/company/index.html', ROOT)), false);
  assert.match(source('src/App.jsx'), /path="\/diff\/company\/?"/);
});

test('the canonical snippet tries both signed-in sessions and normalizes the first email found', async () => {
  const result = await runPendoScript({
    responses: [unauthorized(), okJson({ email: '  Person@Example.COM  ' })],
  });

  assert.deepEqual(
    result.calls.map(({ url }) => url),
    ['/oauth2/userinfo', '/oauth2-desktop/userinfo'],
  );
  for (const call of result.calls) {
    assert.deepEqual(call.options, { credentials: 'same-origin' });
  }
  assert.equal(result.initializeCalls.length, 1);
  assert.deepEqual(result.initializeCalls[0][1], {
    visitor: { id: 'person@example.com', email: 'person@example.com' },
    account: { id: 'heydex-website' },
  });
  assert.equal(
    result.document.insertedScripts[0].src,
    `https://cdn.pendo.io/agent/static/${NEW_KEY}/pendo.js`,
  );
});

test('the canonical snippet exposes readiness after its single initialize call', async () => {
  const result = await runPendoScript({
    responses: [unauthorized(), unauthorized()],
  });

  assert.equal(typeof result.window.dexPendoReady?.then, 'function');
  await result.window.dexPendoReady;
  assert.equal(result.initializeCalls.length, 1);
});

test('the first valid signed-in email wins without requesting the desktop session', async () => {
  const result = await runPendoScript({
    responses: [okJson({ email: 'first@example.com' })],
  });

  assert.deepEqual(result.calls.map(({ url }) => url), ['/oauth2/userinfo']);
  assert.equal(result.initializeCalls[0][1].visitor.id, 'first@example.com');
});

test('anonymous identity is persisted with randomUUID and reused', async () => {
  const values = new Map();
  const storage = mapStorage(values);
  const first = await runPendoScript({
    responses: [unauthorized(), unauthorized()],
    storage,
    crypto: { randomUUID: () => 'stable-uuid' },
  });
  const second = await runPendoScript({
    responses: [unauthorized(), unauthorized()],
    storage,
    crypto: { randomUUID: () => { throw new Error('stored id should win'); } },
  });

  assert.equal(values.get('dex_web_visitor'), 'web-stable-uuid');
  assert.deepEqual(first.initializeCalls[0][1].visitor, { id: 'web-stable-uuid' });
  assert.deepEqual(second.initializeCalls[0][1].visitor, { id: 'web-stable-uuid' });
});

test('anonymous identity falls back to Math.random when randomUUID is unavailable', async () => {
  const math = Object.create(Math);
  math.random = () => 0.25;
  const result = await runPendoScript({
    responses: [unauthorized(), unauthorized()],
    crypto: {},
    math,
  });

  assert.deepEqual(result.initializeCalls[0][1].visitor, {
    id: `web-${math.random().toString(36).slice(2)}`,
  });
});

test('fetch and localStorage failures resolve to web-anonymous without escaping', async () => {
  const storage = {
    getItem() {
      throw new Error('storage blocked');
    },
    setItem() {
      throw new Error('storage blocked');
    },
  };
  const result = await runPendoScript({
    responses: [new Error('network down'), new Error('network down')],
    storage,
  });

  assert.deepEqual(result.calls.map(({ url }) => url), [
    '/oauth2/userinfo',
    '/oauth2-desktop/userinfo',
  ]);
  assert.deepEqual(result.initializeCalls[0][1].visitor, { id: 'web-anonymous' });
});

test('SPA identification normalizes email, includes the SPA account, and fires once per email', async () => {
  const { identifyPendoVisitor } = await import('../src/analytics/pendoIdentity.js');
  const calls = [];
  const pendo = { identify: (options) => calls.push(options) };

  identifyPendoVisitor('  Mixed.Case@Example.COM  ', pendo);
  identifyPendoVisitor('mixed.case@example.com', pendo);

  assert.deepEqual(calls, [{
    visitor: {
      id: 'mixed.case@example.com',
      email: 'mixed.case@example.com',
    },
    account: { id: 'heydex-website' },
  }]);
});

test('SPA identification is safe when Pendo is absent or throws', async () => {
  const { identifyPendoVisitor } = await import('../src/analytics/pendoIdentity.js');
  assert.doesNotThrow(() => identifyPendoVisitor('absent@example.com', undefined));
  assert.doesNotThrow(() => identifyPendoVisitor('throwing@example.com', {
    identify() {
      throw new Error('Pendo unavailable');
    },
  }));
});

test('SPA identification waits for inline initialization and can be cancelled', async () => {
  const { identifyPendoVisitorAfterInitialization } = await import(
    '../src/analytics/pendoIdentity.js'
  );
  const calls = [];
  let resolveReady;
  const browserWindow = {
    dexPendoReady: new Promise((resolve) => {
      resolveReady = resolve;
    }),
    pendo: { identify: (options) => calls.push(options) },
  };

  const cancel = identifyPendoVisitorAfterInitialization(
    'ordered@example.com',
    browserWindow,
  );
  assert.equal(calls.length, 0);

  resolveReady();
  await waitForImmediate();
  assert.equal(calls.length, 1);

  const cancelPending = identifyPendoVisitorAfterInitialization(
    'cancelled@example.com',
    { dexPendoReady: Promise.resolve(), pendo: browserWindow.pendo },
  );
  cancelPending();
  await waitForImmediate();
  assert.equal(calls.length, 1);
  cancel();
});

test('SPA has one inline initialize path and preserves custom track events', () => {
  const appEntry = source('index.html');
  const connectPage = source('src/pages/ConnectPage.jsx');
  const registrationFlow = source('src/components/RegistrationFlow.jsx');

  assert.equal(occurrences(appEntry, 'pendo.initialize('), 1);
  assert.equal(occurrences(connectPage, 'pendo.initialize('), 0);
  assert.equal(occurrences(connectPage, 'pendo?.identify'), 0);
  assert.match(connectPage, /pendo\?\.track\('registration_complete'\)/);
  assert.match(registrationFlow, /pendo\?\.track\('registration_complete', \{ handle \}\)/);
  assert.match(
    source('src/App.jsx'),
    /identifyPendoVisitorAfterInitialization\(currentUser\?\.email\)/,
  );
});
