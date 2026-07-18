import { createHash, randomBytes } from 'node:crypto';
import { readFile as nodeReadFile, writeFile as nodeWriteFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

import {
  assertAbsolutePath,
  assertExecutor,
  assertFilesystem,
  assertFixedRemoteRoots,
  assertSshTarget,
  assertTargetAbsent,
  assertTransactionPaths,
  constants,
  createLocalExecutor,
  createNodeFilesystem,
  ensureStateDirectory,
  fileIdentity,
  makeStateDirectory,
  normalizeSecurity,
  preflightFixedRoots,
  readJsonFile,
  sameFileIdentity,
  setJournalPhase,
  stageCliKeyFile,
  syncJournal,
} from './direct-file-primitives.mjs';
import { createFixedSshSeams } from './direct-file-ssh-executor.mjs';
import { createFixedDirectFileVerifier, isFixedDirectFileOauthGateUrl } from './direct-file-verifier.mjs';

export const DIRECT_FILE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'; connect-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export const DIRECT_FILE_POLICY_VERSION = 'direct-file-policy-v1';
export const DIRECT_FILE_URL = constants.directUrl;
const SCHEMA_VERSION = 1;
const SHA256 = /^[a-f0-9]{64}$/;
const NONCE = /^[a-f0-9]{64}$/;
const METADATA_KEYS = new Set(['schemaVersion', 'slug', 'title', 'summary', 'createdAt', 'artifactSha256']);
const FINALIZATION_EVIDENCE_KEYS = new Set(['schemaVersion', 'kind', 'transactionId', 'verificationNonce', 'promotedAt', 'url', 'artifactSha256', 'artifactSize', 'capturedAt', 'authenticated', 'unauthenticated']);
const BLOCKED_TAGS = new Set(['area', 'applet', 'base', 'embed', 'form', 'frame', 'frameset', 'iframe', 'link', 'object', 'portal', 'script']);
const NETWORK_ATTRIBUTES = new Set(['action', 'data', 'formaction', 'href', 'ping', 'poster', 'src', 'srcset', 'xlink:href']);
const SAFE_BOOLEAN_ATTRIBUTES = new Map([['details', new Set(['open'])]]);
const SAFE_DOCUMENT_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const SAFE_ANCHOR_CLASS = /^[A-Za-z_-][A-Za-z0-9_-]*(?: [A-Za-z_-][A-Za-z0-9_-]*)*$/;
const URL_LIKE_TEXT = /(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|\/\/|\b(?:mailto|tel|data|javascript):|\bwww\.)/i;
const SAFE_SVG_NUMBER = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;
const SAFE_SVG_PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZzEe0-9,.+\-\s]+$/;
const SAFE_SVG_PAINT = /^(?:none|currentColor|#[0-9a-fA-F]{3,8})$/;
const STATIC_SVG_ELEMENTS = new Set(['svg', 'circle', 'path']);
const STATIC_SVG_GEOMETRY_ELEMENTS = new Set(['circle', 'path']);
const JOURNAL_PHASES = new Set(['prepared', 'uploading', 'uploaded', 'promoting', 'promoted-awaiting-verification', 'published', 'artifact-quarantining', 'artifact-quarantined', 'staged-removing', 'artifact-removing', 'rolled-back']);

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
  return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
}
function assertNoSecretShape(value) {
  if (typeof value === 'string' && /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:ghp|github_pat|AKIA|sk|pk)_[A-Za-z0-9_-]{16,}|\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*\S+)/i.test(value)) fail('direct-file inputs contain a secret-shaped value');
}
function assertCanonicalTime(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) fail(`${label} must be canonical UTC ISO-8601`);
  return new Date(value);
}

function validateMetadata(metadata) {
  if (!isPlainObject(metadata) || Object.keys(metadata).length !== METADATA_KEYS.size || Object.keys(metadata).some((key) => !METADATA_KEYS.has(key))) fail('metadata must contain exactly the direct-file schema fields');
  if (metadata.schemaVersion !== 1 || metadata.slug !== constants.directSlug) fail('metadata has an unauthorized direct-file schema or slug');
  for (const field of ['title', 'summary']) {
    if (typeof metadata[field] !== 'string' || metadata[field].trim() === '') fail(`metadata.${field} must be non-empty`);
    assertNoSecretShape(metadata[field]);
  }
  assertCanonicalTime(metadata.createdAt, 'metadata.createdAt');
  if (typeof metadata.artifactSha256 !== 'string' || !SHA256.test(metadata.artifactSha256)) fail('metadata.artifactSha256 must be a lowercase SHA-256 hash');
  return JSON.parse(JSON.stringify(metadata));
}

export function directFilename(slug = constants.directSlug) {
  if (slug !== constants.directSlug) fail('direct-file slug is outside the authorized target');
  return constants.directFilename;
}

export function directUrl(slug = constants.directSlug) {
  directFilename(slug);
  return DIRECT_FILE_URL;
}

function isNameStart(character) { return /[A-Za-z]/.test(character); }
function isNameCharacter(character) { return /[A-Za-z0-9:_-]/.test(character); }
function skipWhitespace(text, index) { while (index < text.length && /[\t\n\f\r ]/.test(text[index])) index += 1; return index; }

/** A deliberately small HTML tokenizer for the strict, static artifact grammar. */
function tokenizeHtml(text) {
  const tokens = [];
  let index = 0;
  let textStart = 0;
  const pushText = (end) => { if (end > textStart) tokens.push({ type: 'text', value: text.slice(textStart, end) }); };
  while (index < text.length) {
    if (text[index] !== '<') { index += 1; continue; }
    pushText(index);
    if (text.startsWith('<!--', index)) {
      const end = text.indexOf('-->', index + 4);
      if (end < 0) fail('direct artifact contains an unterminated comment');
      index = end + 3; textStart = index; continue;
    }
    if (/^<!doctype\s/i.test(text.slice(index))) {
      const end = text.indexOf('>', index + 2);
      if (end < 0 || !/^<!doctype\s+html\s*>$/i.test(text.slice(index, end + 1))) fail('direct artifact has malformed markup');
      tokens.push({ type: 'doctype' }); index = end + 1; textStart = index; continue;
    }
    if (text.startsWith('</', index)) {
      let cursor = index + 2;
      if (!isNameStart(text[cursor])) fail('direct artifact has malformed closing markup');
      const start = cursor; while (isNameCharacter(text[cursor])) cursor += 1;
      const name = text.slice(start, cursor).toLowerCase();
      cursor = skipWhitespace(text, cursor);
      if (text[cursor] !== '>') fail('direct artifact has malformed closing markup');
      tokens.push({ type: 'end', name }); index = cursor + 1; textStart = index; continue;
    }
    if (text.startsWith('<!', index) || text.startsWith('<?', index)) fail('direct artifact contains unsupported markup');
    let cursor = index + 1;
    if (!isNameStart(text[cursor])) fail('direct artifact has malformed markup');
    const start = cursor; while (isNameCharacter(text[cursor])) cursor += 1;
    const name = text.slice(start, cursor).toLowerCase();
    const attributes = new Map(); let selfClosing = false;
    while (cursor < text.length) {
      cursor = skipWhitespace(text, cursor);
      if (text.startsWith('/>', cursor)) { selfClosing = true; cursor += 2; break; }
      if (text[cursor] === '>') { cursor += 1; break; }
      if (!isNameStart(text[cursor])) fail('direct artifact has malformed attributes');
      const attributeStart = cursor; while (isNameCharacter(text[cursor])) cursor += 1;
      const attribute = text.slice(attributeStart, cursor).toLowerCase();
      if (attributes.has(attribute)) fail('direct artifact contains duplicate attributes');
      cursor = skipWhitespace(text, cursor);
      if (text[cursor] !== '=') {
        if (!SAFE_BOOLEAN_ATTRIBUTES.get(name)?.has(attribute)) fail('direct artifact contains an unsupported boolean attribute');
        attributes.set(attribute, null); continue;
      }
      cursor = skipWhitespace(text, cursor + 1);
      const quote = text[cursor];
      if (quote !== '"' && quote !== "'") fail('direct artifact contains an unquoted attribute');
      const valueStart = ++cursor;
      while (cursor < text.length && text[cursor] !== quote) {
        if (text[cursor] === '<' || text[cursor] === '\0') fail('direct artifact has malformed attribute content');
        cursor += 1;
      }
      if (cursor >= text.length) fail('direct artifact has an unterminated attribute');
      attributes.set(attribute, text.slice(valueStart, cursor)); cursor += 1;
    }
    if (cursor > text.length || text[cursor - 1] !== '>') fail('direct artifact has unterminated markup');
    tokens.push({ type: 'start', name, attributes, selfClosing }); index = cursor; textStart = index;
  }
  pushText(text.length);
  return tokens;
}

function normalizedViewportContent(value) {
  if (typeof value !== 'string') return null;
  const values = value.split(',').map((part) => part.trim().toLowerCase().replace(/\s*=\s*/g, '=')).filter(Boolean);
  if (values.length !== 2 || new Set(values).size !== 2) return null;
  return new Set(values).has('width=device-width') && new Set(values).has('initial-scale=1') ? values : null;
}

function normalizedColorSchemeContent(value) {
  return typeof value === 'string' && value.trim().toLowerCase() === 'dark';
}

function isSafeAnchorText(value) {
  if (typeof value !== 'string' || value.trim() === '' || /[\u0000-\u001F\u007F]/.test(value) || URL_LIKE_TEXT.test(value)) return false;
  try { assertNoSecretShape(value); } catch { return false; }
  return true;
}

function assertSafeDocumentId(value) {
  if (typeof value !== 'string' || !SAFE_DOCUMENT_ID.test(value)) fail('direct artifact contains an unsafe document id');
}

function safeFragmentTarget(token) {
  if (!token.attributes.has('href') || [...token.attributes.keys()].some((attribute) => !['href', 'class', 'aria-label'].includes(attribute))) fail('direct artifact anchor has unsupported attributes');
  const href = token.attributes.get('href');
  if (typeof href !== 'string' || !/^#[A-Za-z][A-Za-z0-9_-]*$/.test(href)) fail('direct artifact anchor must use a safe same-document fragment');
  if (token.attributes.has('class') && (!SAFE_ANCHOR_CLASS.test(token.attributes.get('class')) || !isSafeAnchorText(token.attributes.get('class')))) fail('direct artifact anchor has unsafe class text');
  if (token.attributes.has('aria-label') && !isSafeAnchorText(token.attributes.get('aria-label'))) fail('direct artifact anchor has unsafe aria-label text');
  return href.slice(1);
}

function hasExactAttributeNames(attributes, expected) {
  return attributes.size === expected.length && expected.every((attribute) => attributes.has(attribute));
}

function isSafeSelfClosingSvgGeometry(token) {
  if (!token.selfClosing) return false;
  const { attributes } = token;
  if (token.name === 'circle' && hasExactAttributeNames(attributes, ['cx', 'cy', 'fill', 'r'])) {
    return SAFE_SVG_NUMBER.test(attributes.get('cx'))
      && SAFE_SVG_NUMBER.test(attributes.get('cy'))
      && SAFE_SVG_NUMBER.test(attributes.get('r'))
      && SAFE_SVG_PAINT.test(attributes.get('fill'));
  }
  if (token.name !== 'path' || !SAFE_SVG_PATH_DATA.test(attributes.get('d')) || !SAFE_SVG_PAINT.test(attributes.get('fill'))) return false;
  if (hasExactAttributeNames(attributes, ['d', 'fill'])) return true;
  if (hasExactAttributeNames(attributes, ['d', 'fill', 'stroke', 'stroke-linecap', 'stroke-width'])) {
    return SAFE_SVG_PAINT.test(attributes.get('stroke'))
      && SAFE_SVG_NUMBER.test(attributes.get('stroke-width'))
      && /^(?:butt|round|square)$/.test(attributes.get('stroke-linecap'));
  }
  return hasExactAttributeNames(attributes, ['d', 'fill', 'stroke', 'stroke-width', 'vector-effect'])
    && SAFE_SVG_PAINT.test(attributes.get('stroke'))
    && SAFE_SVG_NUMBER.test(attributes.get('stroke-width'))
    && attributes.get('vector-effect') === 'non-scaling-stroke';
}

function assertHtmlPolicy(bytes) {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes) || text.includes('\0')) fail('direct artifact must be UTF-8 without NUL bytes');
  const tokens = tokenizeHtml(text);
  if (tokens[0]?.type !== 'doctype') fail('direct artifact must begin with an HTML doctype');
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const stack = [];
  const documentIdCounts = new Map();
  const fragmentTargets = [];
  let htmlOpened = false; let htmlClosed = false; let cspCount = 0; let charsetCount = 0; let viewportCount = 0; let colorSchemeCount = 0; let styleDepth = 0;
  for (const token of tokens) {
    if (token.type === 'text') {
      if (stack.length === 0 && token.value.trim() !== '') fail('direct artifact has text outside the HTML document');
      if (styleDepth > 0 && /(?:@import|\burl\s*\()/i.test(token.value)) fail('direct artifact style content has a network surface');
      continue;
    }
    if (token.type === 'doctype') continue;
    if (token.type === 'end') {
      if (voidTags.has(token.name) || stack.pop() !== token.name) fail('direct artifact has malformed element nesting');
      if (token.name === 'style') styleDepth -= 1;
      if (styleDepth < 0) fail('direct artifact has malformed style markup');
      if (token.name === 'html') htmlClosed = true;
      continue;
    }
    if (BLOCKED_TAGS.has(token.name)) fail('direct artifact contains navigation-capable or executable markup');
    const insideSvg = stack.includes('svg');
    if ((insideSvg || token.name === 'svg') && !STATIC_SVG_ELEMENTS.has(token.name)) fail('direct artifact contains unsupported SVG markup');
    if (!insideSvg && STATIC_SVG_GEOMETRY_ELEMENTS.has(token.name)) fail('direct artifact contains SVG geometry outside an SVG container');
    if (token.attributes.has('id')) {
      const id = token.attributes.get('id');
      assertSafeDocumentId(id);
      const count = (documentIdCounts.get(id) ?? 0) + 1;
      if (count > 1) fail('direct artifact contains duplicate document ids');
      documentIdCounts.set(id, count);
    }
    const fragmentTarget = token.name === 'a' ? safeFragmentTarget(token) : null;
    if (fragmentTarget !== null) fragmentTargets.push(fragmentTarget);
    if (token.name === 'html') {
      if (htmlOpened || htmlClosed || token.selfClosing) fail('direct artifact has malformed HTML document boundaries');
      htmlOpened = true;
    }
    if (token.name === 'meta') {
      const httpEquiv = token.attributes.get('http-equiv')?.trim().toLowerCase();
      const charset = token.attributes.get('charset')?.trim().toLowerCase();
      const name = token.attributes.get('name')?.trim().toLowerCase();
      if (httpEquiv === 'refresh') fail('direct artifact contains meta refresh navigation');
      if (httpEquiv === 'content-security-policy' && token.attributes.size === 2 && token.attributes.get('content') === DIRECT_FILE_CSP) {
        cspCount += 1;
      } else if (charset === 'utf-8' && token.attributes.size === 1) {
        charsetCount += 1;
      } else if (name === 'viewport' && token.attributes.size === 2 && normalizedViewportContent(token.attributes.get('content'))) {
        viewportCount += 1;
      } else if (name === 'color-scheme' && token.attributes.size === 2 && normalizedColorSchemeContent(token.attributes.get('content'))) {
        colorSchemeCount += 1;
      } else {
        fail('direct artifact contains an unsupported meta declaration');
      }
    }
    for (const [attribute, value] of token.attributes) {
      if (value === null && !SAFE_BOOLEAN_ATTRIBUTES.get(token.name)?.has(attribute)) fail('direct artifact contains an unsupported boolean attribute');
      if (attribute.startsWith('on') || NETWORK_ATTRIBUTES.has(attribute)) {
        const allowedDataImage = token.name === 'img' && attribute === 'src' && /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(value);
        const allowedFragmentAnchor = token.name === 'a' && attribute === 'href' && fragmentTarget !== null;
        if (!allowedDataImage && !allowedFragmentAnchor) fail('direct artifact contains a script, network surface, or navigation attribute');
      }
      if (attribute === 'style' && /(?:@import|\burl\s*\()/i.test(value)) fail('direct artifact style content has a network surface');
      if (attribute === 'http-equiv' && value.toLowerCase() === 'refresh') fail('direct artifact contains meta refresh navigation');
    }
    if (!voidTags.has(token.name)) {
      if (insideSvg && STATIC_SVG_GEOMETRY_ELEMENTS.has(token.name) && !isSafeSelfClosingSvgGeometry(token)) fail('direct artifact contains unsupported static SVG geometry');
      if (token.selfClosing) {
        if (!stack.includes('svg') || !isSafeSelfClosingSvgGeometry(token)) fail('direct artifact has unsupported self-closing markup');
        continue;
      }
      stack.push(token.name);
      if (token.name === 'style') styleDepth += 1;
    }
  }
  for (const target of fragmentTargets) {
    if (documentIdCounts.get(target) !== 1) fail('direct artifact anchor fragment does not resolve to exactly one document id');
  }
  if (!htmlOpened || !htmlClosed || stack.length !== 0 || styleDepth !== 0 || cspCount !== 1 || charsetCount > 1 || viewportCount > 1 || colorSchemeCount > 1) fail('direct artifact must be a complete static HTML document');
  if (/(?:serviceWorker|XMLHttpRequest|\bfetch\s*\(|WebSocket|EventSource|sendBeacon|javascript\s*:)/i.test(text)) fail('direct artifact contains a JavaScript or network API marker');
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
  if (prepared.artifactSize !== bytes.length || prepared.csp !== DIRECT_FILE_CSP || prepared.policyVersion !== DIRECT_FILE_POLICY_VERSION) fail('prepared direct file has an unsupported identity or policy');
  if (!Array.isArray(prepared.forbiddenStrings) || prepared.forbiddenStrings.length === 0 || prepared.forbiddenStrings.some((value) => typeof value !== 'string' || value.trim() === '')) fail('prepared direct file has invalid forbidden response markers');
  assertHtmlPolicy(bytes);
  return { ...prepared, metadata, forbiddenStrings: [...prepared.forbiddenStrings] };
}

export function serializableDirectFile(prepared) { return assertPreparedDirectFile(prepared); }
export function deserializeDirectFile(value) { return assertPreparedDirectFile(value); }
function preparedBytes(prepared) { return Buffer.from(prepared.artifactBytesBase64, 'base64'); }

function validateEvidencePart(value, label, expectedHash, expectedSize) {
  if (!isPlainObject(value) || !Number.isInteger(value.status) || typeof value.bodySha256 !== 'string' || !SHA256.test(value.bodySha256) || !Array.isArray(value.requestUrls) || value.requestUrls.some((url) => typeof url !== 'string')) fail(`${label} verification evidence is malformed`);
  if (label === 'authenticated') {
    if (value.status !== 200 || value.bodySha256 !== expectedHash || value.bodySize !== expectedSize || value.xRobotsTag !== 'noindex, nofollow, noarchive' || value.requestUrls.length !== 1 || value.requestUrls[0] !== DIRECT_FILE_URL) fail('authenticated verification evidence does not prove the exact private artifact');
  } else if (![302, 303, 307, 308].includes(value.status) || value.bodySha256 === expectedHash || value.artifactLeaked !== false || value.requestUrls.length !== 1 || value.requestUrls[0] !== DIRECT_FILE_URL || !isFixedDirectFileOauthGateUrl(value.location)) {
    fail('unauthenticated verification evidence does not prove redirect and no leak');
  }
}

export function validateFinalizationEvidence(evidence, journal, now = () => new Date()) {
  if (!isPlainObject(evidence) || Object.keys(evidence).length !== FINALIZATION_EVIDENCE_KEYS.size || Object.keys(evidence).some((key) => !FINALIZATION_EVIDENCE_KEYS.has(key))) fail('finalization evidence must contain exactly the direct-file schema fields');
  if (evidence.schemaVersion !== 1 || evidence.kind !== 'direct-file-finalization' || evidence.transactionId !== journal.transactionId || evidence.verificationNonce !== journal.verificationNonce || evidence.promotedAt !== journal.promotedAt || evidence.url !== DIRECT_FILE_URL || evidence.artifactSha256 !== journal.artifactSha256 || evidence.artifactSize !== journal.artifactSize) fail('finalization evidence is not bound to the promoted direct artifact');
  const capturedAt = assertCanonicalTime(evidence.capturedAt, 'verification evidence capturedAt');
  const promotedAt = assertCanonicalTime(journal.promotedAt, 'journal promotedAt');
  const current = now();
  if (!(current instanceof Date) || Number.isNaN(current.valueOf()) || capturedAt < promotedAt || capturedAt > current || current - capturedAt > 30 * 60 * 1000) fail('finalization evidence timestamp is not current and post-promotion');
  validateEvidencePart(evidence.authenticated, 'authenticated', journal.artifactSha256, journal.artifactSize);
  validateEvidencePart(evidence.unauthenticated, 'unauthenticated', journal.artifactSha256, journal.artifactSize);
  return JSON.parse(JSON.stringify(evidence));
}

function journalFor(prepared, transactionId, security) {
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
    targetPath: `${constants.galleryRoot}/${prepared.filename}`,
    stagingPath: `${constants.stateRoot}/staging/${transactionId}/${prepared.filename}`,
    quarantinePath: `${constants.stateRoot}/transactions/${transactionId}/quarantine/${prepared.filename}`,
    artifactIdentity: { type: 'regular', uid: security.web.uid, gid: security.web.gid, mode: security.web.fileMode },
    phase: 'prepared',
    phases: {},
    publicationVerification: { status: 'pending' },
    formerUrlVerification: { status: 'pending' },
  };
}

function validateIdentity(value, label) {
  if (!isPlainObject(value) || !Number.isInteger(value.device) || !Number.isInteger(value.inode)) fail(`${label} must record device and inode`);
  return value;
}

function validateJournal(journal, transactionId, security) {
  if (!isPlainObject(journal) || journal.schemaVersion !== 1 || journal.kind !== 'direct-file' || journal.transactionId !== transactionId) fail('transaction journal is not the requested direct-file transaction');
  const metadata = validateMetadata(journal.metadata);
  if (journal.slug !== constants.directSlug || journal.filename !== constants.directFilename || journal.url !== DIRECT_FILE_URL || metadata.slug !== journal.slug) fail('transaction journal has an inconsistent fixed identity');
  if (journal.artifactSha256 !== metadata.artifactSha256 || !SHA256.test(journal.artifactSha256) || !Number.isSafeInteger(journal.artifactSize) || journal.artifactSize < 1) fail('transaction journal has an invalid artifact identity');
  if (journal.csp !== DIRECT_FILE_CSP || journal.policyVersion !== DIRECT_FILE_POLICY_VERSION || !Array.isArray(journal.forbiddenStrings)) fail('transaction journal has an invalid content policy');
  if (journal.targetPath !== `${constants.galleryRoot}/${constants.directFilename}` || journal.stagingPath !== `${constants.stateRoot}/staging/${transactionId}/${constants.directFilename}` || journal.quarantinePath !== `${constants.stateRoot}/transactions/${transactionId}/quarantine/${constants.directFilename}`) fail('transaction journal has an unsafe fixed path');
  if (!isPlainObject(journal.artifactIdentity) || journal.artifactIdentity.type !== 'regular' || journal.artifactIdentity.uid !== security.web.uid || journal.artifactIdentity.gid !== security.web.gid || journal.artifactIdentity.mode !== security.web.fileMode) fail('transaction journal has an invalid file identity');
  if (!isPlainObject(journal.phases) || !JOURNAL_PHASES.has(journal.phase) || !isPlainObject(journal.publicationVerification) || !isPlainObject(journal.formerUrlVerification)) fail('transaction journal has invalid state');
  if (journal.stagedIdentity !== undefined) validateIdentity(journal.stagedIdentity, 'staged identity');
  if (journal.promotedIdentity !== undefined) validateIdentity(journal.promotedIdentity, 'promoted identity');
  if (['uploaded', 'promoting'].includes(journal.phase) && journal.stagedIdentity === undefined) fail('transaction journal is missing its staged identity');
  const promotedPhases = ['promoted-awaiting-verification', 'published', 'artifact-quarantining', 'artifact-quarantined', 'artifact-removing'];
  if (promotedPhases.includes(journal.phase) && journal.promotedIdentity === undefined) fail('transaction journal is missing its promoted identity');
  if (['promoted-awaiting-verification', 'published'].includes(journal.phase)) {
    if (typeof journal.verificationNonce !== 'string' || !NONCE.test(journal.verificationNonce)) fail('transaction journal is missing its finalization nonce');
    assertCanonicalTime(journal.promotedAt, 'journal promotedAt');
  }
  return journal;
}

async function targetIdentity(fs, target, journal) {
  const stat = await fs.lstat(target).catch((error) => { if (error?.code === 'ENOENT') return null; throw error; });
  if (stat === null) return 'absent';
  if (!stat.isFile?.() || stat.isSymbolicLink?.()) return 'drift';
  if (stat.uid !== journal.artifactIdentity.uid || stat.gid !== journal.artifactIdentity.gid || (stat.mode & 0o777) !== journal.artifactIdentity.mode) return 'drift';
  const bytes = Buffer.from(await fs.readFile(target));
  if (bytes.length !== journal.artifactSize || hash(bytes) !== journal.artifactSha256) return 'drift';
  try { assertHtmlPolicy(bytes); } catch { return 'drift'; }
  return { state: 'candidate', identity: fileIdentity(stat) };
}

function assertRecoveryOwnership(live, staged, journal) {
  if (live?.state === 'candidate' && staged?.state === 'candidate') fail('direct-file collision preserves live and staged files for reconciliation');
  if (staged?.state === 'candidate' && journal.stagedIdentity && !sameFileIdentity(journal.stagedIdentity, staged.identity)) fail('staged direct-file identity drift refuses deletion');
  if (live?.state !== 'candidate') return;
  if (journal.phase === 'promoting') {
    if (staged !== 'absent' || !sameFileIdentity(journal.stagedIdentity, live.identity)) fail('promoting recovery cannot prove the live target was renamed from staged content');
    return;
  }
  if (!sameFileIdentity(journal.promotedIdentity, live.identity)) fail('promoted direct-file identity drift refuses deletion');
}

function assertQuarantineOwnership(quarantined, journal) {
  if (quarantined?.state === 'candidate' && !sameFileIdentity(journal.promotedIdentity, quarantined.identity)) fail('quarantined direct-file identity drift refuses deletion');
}

async function guardPaths(fs, roots, transactionId, security, options = {}) {
  return assertTransactionPaths({ fs, roots, transactionId, security, ...options });
}

function createVerificationNonce(bytes = randomBytes(32)) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== 32) fail('verification nonce source returned invalid bytes');
  return bytes.toString('hex');
}

export async function publishDirectFile({ prepared, galleryRoot = constants.galleryRoot, stateRoot = constants.stateRoot, transactionId, security, fs = createNodeFilesystem(), executor = createLocalExecutor(fs), now = () => new Date(), nonceBytes = () => randomBytes(32), phaseHook }) {
  const reviewed = assertPreparedDirectFile(prepared);
  const artifactBytes = preparedBytes(reviewed);
  const validFs = assertFilesystem(fs); const validExecutor = assertExecutor(executor); const validSecurity = normalizeSecurity(security);
  const fixedRoots = assertFixedRemoteRoots(galleryRoot, stateRoot);
  const roots = await preflightFixedRoots({ fs: validFs, ...fixedRoots, security: validSecurity, requiredBytes: Math.max(validSecurity.minFreeBytes, reviewed.artifactSize * 3 + 65_536) });
  await ensureStateDirectory(validFs, `${roots.stateRoot}/transactions`, validSecurity.state, roots.device);
  await ensureStateDirectory(validFs, `${roots.stateRoot}/staging`, validSecurity.state, roots.device);
  let paths = await guardPaths(validFs, roots, transactionId, validSecurity);
  await assertTargetAbsent({ fs: validFs, executor: validExecutor, galleryRoot: roots.galleryRoot, slug: reviewed.slug });
  await makeStateDirectory(validFs, paths.transactionRoot, validSecurity.state, roots.device);
  paths = await guardPaths(validFs, roots, transactionId, validSecurity, { requireTransaction: true });
  const journal = journalFor(reviewed, transactionId, validSecurity);
  await syncJournal(validFs, paths.journalPath, journal, validSecurity.state, now, roots.device);
  paths = await guardPaths(validFs, roots, transactionId, validSecurity, { requireTransaction: true, requireJournal: true });
  await validFs.writeAtomic({ directory: paths.transactionRoot, filename: 'reviewed-direct-file.json', contents: `${JSON.stringify(serializableDirectFile(reviewed), null, 2)}\n`, mode: validSecurity.state.fileMode, uid: validSecurity.state.uid, gid: validSecurity.state.gid, replace: false });
  try {
    await setJournalPhase(validFs, paths.journalPath, journal, 'uploading', validSecurity.state, now, roots.device, phaseHook);
    paths = await guardPaths(validFs, roots, transactionId, validSecurity, { requireTransaction: true, requireJournal: true });
    await makeStateDirectory(validFs, paths.stageDirectory, validSecurity.state, roots.device);
    paths = await guardPaths(validFs, roots, transactionId, validSecurity, { requireTransaction: true, requireJournal: true, requireStage: true });
    await validFs.writeAtomic({ directory: paths.stageDirectory, filename: reviewed.filename, contents: artifactBytes, mode: validSecurity.web.fileMode, uid: validSecurity.web.uid, gid: validSecurity.web.gid, replace: false });
    paths = await guardPaths(validFs, roots, transactionId, validSecurity, { requireTransaction: true, requireJournal: true, requireStage: true, requireStaged: true });
    const staged = await targetIdentity(validFs, paths.stagedTarget, journal);
    if (staged?.state !== 'candidate') fail('staged direct-file identity failed validation');
    journal.stagedIdentity = staged.identity;
    await setJournalPhase(validFs, paths.journalPath, journal, 'uploaded', validSecurity.state, now, roots.device, phaseHook);
    paths = await guardPaths(validFs, roots, transactionId, validSecurity, { requireTransaction: true, requireJournal: true, requireStage: true, requireStaged: true });
    await assertTargetAbsent({ fs: validFs, executor: validExecutor, galleryRoot: roots.galleryRoot, slug: reviewed.slug });
    await setJournalPhase(validFs, paths.journalPath, journal, 'promoting', validSecurity.state, now, roots.device, phaseHook);
    paths = await guardPaths(validFs, roots, transactionId, validSecurity, { requireTransaction: true, requireJournal: true, requireStage: true, requireStaged: true });
    await assertTargetAbsent({ fs: validFs, executor: validExecutor, galleryRoot: roots.galleryRoot, slug: reviewed.slug });
    await validFs.renameNoReplace(paths.stagedTarget, paths.target);
    await validFs.fsyncDirectory(roots.galleryRoot);
    paths = await guardPaths(validFs, roots, transactionId, validSecurity, { requireTransaction: true, requireJournal: true, requireStage: true, requireTarget: true });
    const promoted = await targetIdentity(validFs, paths.target, journal);
    if (promoted?.state !== 'candidate' || !sameFileIdentity(journal.stagedIdentity, promoted.identity)) fail('promoted direct-file identity failed validation');
    journal.promotedIdentity = promoted.identity;
    const promotedAt = now();
    if (!(promotedAt instanceof Date) || Number.isNaN(promotedAt.valueOf())) fail('clock must return a valid date');
    journal.promotedAt = promotedAt.toISOString();
    journal.verificationNonce = createVerificationNonce(nonceBytes());
    await setJournalPhase(validFs, paths.journalPath, journal, 'promoted-awaiting-verification', validSecurity.state, now, roots.device, phaseHook);
    return { transactionId, transactionRoot: paths.transactionRoot, journal: { ...journal }, prepared: serializableDirectFile(reviewed) };
  } catch (error) {
    try { await rollbackDirectFile({ transactionId, security: validSecurity, fs: validFs, executor: validExecutor, now, phaseHook }); } catch (recoveryError) { throw new DirectFileValidationError(`direct-file publication recovery failed: ${recoveryError.message}`, { cause: error }); }
    throw error;
  }
}

function assertVerifier(verifier) {
  if (!verifier || typeof verifier.verify !== 'function') fail('direct-file finalizer requires the fixed verifier');
  return verifier;
}

export async function finalizeDirectFile({ galleryRoot = constants.galleryRoot, stateRoot = constants.stateRoot, transactionId, security, verifier, fs = createNodeFilesystem(), executor = createLocalExecutor(fs), now = () => new Date(), phaseHook }) {
  const validFs = assertFilesystem(fs); const validExecutor = assertExecutor(executor); const validSecurity = normalizeSecurity(security); const validVerifier = assertVerifier(verifier);
  const fixedRoots = assertFixedRemoteRoots(galleryRoot, stateRoot);
  const roots = await preflightFixedRoots({ fs: validFs, ...fixedRoots, security: validSecurity, requiredBytes: validSecurity.minFreeBytes });
  let paths = await guardPaths(validFs, roots, transactionId, validSecurity, { requireTransaction: true, requireJournal: true, requireTarget: true });
  const journal = validateJournal(await readJsonFile(validFs, paths.journalPath, validSecurity.state, roots.device, 'direct-file transaction journal'), transactionId, validSecurity);
  if (journal.phase !== 'promoted-awaiting-verification') fail('direct-file transaction is not awaiting finalization');
  const liveBeforeVerification = await targetIdentity(validFs, paths.target, journal);
  if (liveBeforeVerification?.state !== 'candidate' || !sameFileIdentity(journal.promotedIdentity, liveBeforeVerification.identity)) fail('promoted direct-file identity drift refuses finalization');
  const evidence = validateFinalizationEvidence(await validVerifier.verify({
    transactionId: journal.transactionId,
    verificationNonce: journal.verificationNonce,
    promotedAt: journal.promotedAt,
    url: journal.url,
    artifactSha256: journal.artifactSha256,
    artifactSize: journal.artifactSize,
    forbiddenStrings: journal.forbiddenStrings,
  }), journal, now);
  paths = await guardPaths(validFs, roots, transactionId, validSecurity, { requireTransaction: true, requireJournal: true, requireTarget: true });
  const currentJournal = validateJournal(await readJsonFile(validFs, paths.journalPath, validSecurity.state, roots.device, 'direct-file transaction journal'), transactionId, validSecurity);
  if (currentJournal.phase !== 'promoted-awaiting-verification' || currentJournal.verificationNonce !== journal.verificationNonce || currentJournal.promotedAt !== journal.promotedAt || !sameFileIdentity(currentJournal.promotedIdentity, journal.promotedIdentity)) fail('direct-file transaction changed during finalization');
  const liveAfterVerification = await targetIdentity(validFs, paths.target, currentJournal);
  if (liveAfterVerification?.state !== 'candidate' || !sameFileIdentity(currentJournal.promotedIdentity, liveAfterVerification.identity)) fail('promoted direct-file identity drift refuses finalization');
  currentJournal.publicationVerification = { status: 'verified', evidence };
  await syncJournal(validFs, paths.journalPath, currentJournal, validSecurity.state, now, roots.device);
  await setJournalPhase(validFs, paths.journalPath, currentJournal, 'published', validSecurity.state, now, roots.device, phaseHook);
  return { transactionId, transactionRoot: paths.transactionRoot, journal: { ...currentJournal } };
}

export async function rollbackDirectFile({ galleryRoot = constants.galleryRoot, stateRoot = constants.stateRoot, transactionId, security, verifyOnly = false, fs = createNodeFilesystem(), executor = createLocalExecutor(fs), now = () => new Date(), phaseHook }) {
  const validFs = assertFilesystem(fs); const validExecutor = assertExecutor(executor); const validSecurity = normalizeSecurity(security);
  const fixedRoots = assertFixedRemoteRoots(galleryRoot, stateRoot);
  const roots = await preflightFixedRoots({ fs: validFs, ...fixedRoots, security: validSecurity, requiredBytes: validSecurity.minFreeBytes });
  let paths = await guardPaths(validFs, roots, transactionId, validSecurity, { requireTransaction: true, requireJournal: true });
  const journal = validateJournal(await readJsonFile(validFs, paths.journalPath, validSecurity.state, roots.device, 'direct-file transaction journal'), transactionId, validSecurity);
  if (journal.phase === 'rolled-back') fail('direct-file transaction is already rolled back');
  paths = await guardPaths(validFs, roots, transactionId, validSecurity, { requireTransaction: true, requireJournal: true });
  const live = await targetIdentity(validFs, paths.target, journal);
  const staged = paths.stage ? await targetIdentity(validFs, paths.stagedTarget, journal) : 'absent';
  const quarantined = paths.quarantineDirectoryStat ? await targetIdentity(validFs, paths.quarantineTarget, journal) : 'absent';
  let quarantineCandidate = quarantined?.state === 'candidate';
  if ([live, staged, quarantined].includes('drift')) fail('direct-file server identity drift refuses rollback');
  assertRecoveryOwnership(live, staged, journal);
  if (verifyOnly && quarantined?.state === 'candidate') fail('verify-only requires an absent quarantine target');
  assertQuarantineOwnership(quarantined, journal);
  if (verifyOnly) {
    const plannedOperations = live?.state === 'candidate'
      ? [{ operation: 'rename-no-replace', from: paths.target, to: paths.quarantineTarget }, { operation: 'remove', target: paths.quarantineTarget }, { operation: 'prove-absence', target: paths.target }]
      : staged?.state === 'candidate' ? [{ operation: 'remove', target: paths.stagedTarget }, { operation: 'prove-absence', target: paths.target }]
        : [{ operation: 'prove-absence', target: paths.target }];
    return { transactionId, verifyOnly: true, plannedOperations, journal: { ...journal } };
  }
  if (live?.state === 'candidate' && journal.promotedIdentity === undefined) {
    journal.promotedIdentity = live.identity;
    await syncJournal(validFs, paths.journalPath, journal, validSecurity.state, now, roots.device);
  }
  if (live?.state === 'candidate') {
    if (quarantined !== 'absent') fail('direct-file rollback found an ambiguous quarantine state');
    await makeStateDirectory(validFs, paths.quarantineDirectory, validSecurity.state, roots.device);
    paths = await guardPaths(validFs, roots, transactionId, validSecurity, { requireTransaction: true, requireJournal: true, requireTarget: true, requireQuarantine: true });
    await setJournalPhase(validFs, paths.journalPath, journal, 'artifact-quarantining', validSecurity.state, now, roots.device, phaseHook);
    paths = await guardPaths(validFs, roots, transactionId, validSecurity, { requireTransaction: true, requireJournal: true, requireTarget: true, requireQuarantine: true });
    await validFs.renameNoReplace(paths.target, paths.quarantineTarget);
    await validFs.fsyncDirectory(roots.galleryRoot);
    await validFs.fsyncDirectory(paths.quarantineDirectory);
    await setJournalPhase(validFs, paths.journalPath, journal, 'artifact-quarantined', validSecurity.state, now, roots.device, phaseHook);
    quarantineCandidate = true;
  } else if (staged?.state === 'candidate') {
    await setJournalPhase(validFs, paths.journalPath, journal, 'staged-removing', validSecurity.state, now, roots.device, phaseHook);
    paths = await guardPaths(validFs, roots, transactionId, validSecurity, { requireTransaction: true, requireJournal: true, requireStage: true, requireStaged: true });
    await validFs.rm(paths.stagedTarget, { recursive: false, force: false });
    await validFs.fsyncDirectory(paths.stageDirectory);
    paths = await guardPaths(validFs, roots, transactionId, validSecurity, { requireTransaction: true, requireJournal: true, requireStage: true });
    if (await targetIdentity(validFs, paths.stagedTarget, journal) !== 'absent') fail('staged direct-file target remains after removal');
  } else if (quarantined !== 'absent') {
    if (quarantined?.state !== 'candidate') fail('direct-file rollback found an ambiguous quarantine state');
  }
  if (quarantineCandidate) {
    paths = await guardPaths(validFs, roots, transactionId, validSecurity, { requireTransaction: true, requireJournal: true, requireQuarantine: true, requireQuarantined: true });
    const held = await targetIdentity(validFs, paths.quarantineTarget, journal);
    if (held !== 'absent' && held?.state !== 'candidate') fail('quarantined direct-file identity drift refuses deletion');
    assertQuarantineOwnership(held, journal);
    if (held?.state === 'candidate') {
      await setJournalPhase(validFs, paths.journalPath, journal, 'artifact-removing', validSecurity.state, now, roots.device, phaseHook);
      paths = await guardPaths(validFs, roots, transactionId, validSecurity, { requireTransaction: true, requireJournal: true, requireQuarantine: true, requireQuarantined: true });
      await validFs.rm(paths.quarantineTarget, { recursive: false, force: false });
      await validFs.fsyncDirectory(paths.quarantineDirectory);
    }
  }
  paths = await guardPaths(validFs, roots, transactionId, validSecurity, { requireTransaction: true, requireJournal: true });
  await assertTargetAbsent({ fs: validFs, executor: validExecutor, galleryRoot: roots.galleryRoot, slug: journal.slug });
  journal.formerUrlVerification = { status: 'pending' };
  await setJournalPhase(validFs, paths.journalPath, journal, 'rolled-back', validSecurity.state, now, roots.device, phaseHook);
  return { transactionId, transactionRoot: paths.transactionRoot, journal: { ...journal } };
}

function parseOptions(args) {
  if (args.length % 2 !== 0) fail('CLI options must be --name value pairs');
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!args[index].startsWith('--') || result[args[index]] !== undefined) fail('CLI options must be unique named pairs');
    result[args[index]] = args[index + 1];
  }
  return result;
}
function assertOptionSet(options, allowed) { for (const key of Object.keys(options)) if (!allowed.includes(key)) fail('CLI option is outside the direct-file allowlist'); }
function requireAbsoluteOptions(options, keys, command) {
  for (const key of keys) {
    if (!options[key]) fail(`${command} requires ${key}`);
    assertAbsolutePath(options[key], key);
  }
}

export async function runCli(argv, { stdout = process.stdout } = {}) {
  const [command, ...rest] = argv; const options = parseOptions(rest);
  if (command === 'prepare-file') {
    assertOptionSet(options, ['--artifact', '--metadata', '--output']);
    requireAbsoluteOptions(options, ['--artifact', '--metadata', '--output'], command);
    const prepared = prepareDirectFile({ artifactBytes: await nodeReadFile(options['--artifact']), metadata: JSON.parse((await nodeReadFile(options['--metadata'])).toString('utf8')) });
    await nodeWriteFile(options['--output'], `${JSON.stringify(serializableDirectFile(prepared), null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    stdout.write(`${options['--output']}\n`); return prepared;
  }
  if (command !== 'publish-file' && command !== 'finalize-file' && command !== 'rollback-file') fail('usage: direct-file.mjs <prepare-file|publish-file|finalize-file|rollback-file> --name value ...');
  const publishOptions = ['--prepared', '--promote-only', '--key-file', '--transaction', '--security', '--ssh-host', '--ssh-user'];
  const finalizeOptions = ['--cookie-jar', '--key-file', '--transaction', '--security', '--ssh-host', '--ssh-user'];
  const rollbackOptions = ['--key-file', '--transaction', '--security', '--ssh-host', '--ssh-user', '--verify-only'];
  assertOptionSet(options, command === 'publish-file' ? publishOptions : command === 'finalize-file' ? finalizeOptions : rollbackOptions);
  const absolute = command === 'publish-file' ? ['--prepared', '--key-file', '--security'] : command === 'finalize-file' ? ['--cookie-jar', '--key-file', '--security'] : ['--key-file', '--security'];
  requireAbsoluteOptions(options, absolute, command);
  if (!options['--transaction']) fail(`${command} requires --transaction`);
  if (command === 'publish-file' && options['--promote-only'] !== undefined && options['--promote-only'] !== 'true') fail('--promote-only must be true');
  if (command === 'rollback-file' && options['--verify-only'] !== undefined && options['--verify-only'] !== 'true') fail('--verify-only must be true');
  const ssh = assertSshTarget({ host: options['--ssh-host'], user: options['--ssh-user'] });
  const stagedKey = await stageCliKeyFile(options['--key-file']);
  try {
    const security = JSON.parse((await nodeReadFile(options['--security'])).toString('utf8'));
    const seams = createFixedSshSeams({ keyFile: stagedKey.keyFile, ...ssh });
    if (command === 'rollback-file') return rollbackDirectFile({ transactionId: options['--transaction'], security, verifyOnly: options['--verify-only'] === 'true', fs: seams.fs, executor: seams.executor });
    if (command === 'finalize-file') return finalizeDirectFile({ transactionId: options['--transaction'], security, verifier: createFixedDirectFileVerifier({ cookieJar: options['--cookie-jar'] }), fs: seams.fs, executor: seams.executor });
    const prepared = deserializeDirectFile(JSON.parse((await nodeReadFile(options['--prepared'])).toString('utf8')));
    return publishDirectFile({ prepared, transactionId: options['--transaction'], security, fs: seams.fs, executor: seams.executor });
  } finally { await stagedKey.cleanup(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runCli(process.argv.slice(2)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
