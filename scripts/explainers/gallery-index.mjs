import { createHash } from 'node:crypto';

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const METADATA_KEYS = new Set([
  'schemaVersion',
  'slug',
  'title',
  'summary',
  'createdAt',
  'artifactSha256',
]);

export class GalleryValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GalleryValidationError';
  }
}

function fail(message) {
  throw new GalleryValidationError(message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value, field) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${field} contains a non-finite number`);
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => stableJson(item, `${field}[${index}]`));
  }

  if (!isPlainObject(value)) fail(`${field} must contain JSON values only`);

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableJson(value[key], `${field}.${key}`)]),
  );
}

export function toBuffer(value, field = 'value') {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  fail(`${field} must be a Buffer or Uint8Array`);
}

export function sha256(value) {
  return createHash('sha256').update(toBuffer(value)).digest('hex');
}

export function assertSafeSlug(slug, field = 'slug') {
  if (typeof slug !== 'string' || !SAFE_SLUG.test(slug) || slug.length > 96) {
    fail(`${field} must be a lowercase, hyphen-separated slug`);
  }

  return slug;
}

export function validateMetadata(metadata) {
  if (!isPlainObject(metadata)) fail('metadata must be an object');

  const keys = Object.keys(metadata);
  if (keys.length !== METADATA_KEYS.size || keys.some((key) => !METADATA_KEYS.has(key))) {
    fail('metadata must contain exactly the schema version, artifact hash, and entry fields');
  }

  if (metadata.schemaVersion !== 1) fail('metadata schemaVersion must be 1');
  assertSafeSlug(metadata.slug, 'metadata.slug');

  for (const field of ['title', 'summary']) {
    if (typeof metadata[field] !== 'string' || metadata[field].trim().length === 0) {
      fail(`metadata.${field} must be a non-empty string`);
    }
  }

  if (typeof metadata.createdAt !== 'string' || Number.isNaN(Date.parse(metadata.createdAt))) {
    fail('metadata.createdAt must be an ISO-8601 timestamp');
  }

  if (new Date(metadata.createdAt).toISOString() !== metadata.createdAt) {
    fail('metadata.createdAt must use canonical UTC ISO-8601 form');
  }

  if (typeof metadata.artifactSha256 !== 'string' || !SHA256.test(metadata.artifactSha256)) {
    fail('metadata.artifactSha256 must be a lowercase SHA-256 hash');
  }

  return cloneJson(metadata);
}

export function assertAdapterContract(adapter) {
  if (!isPlainObject(adapter)) fail('adapter must be an object');

  for (const method of ['fingerprint', 'inventory', 'createCandidate']) {
    if (typeof adapter[method] !== 'function') {
      fail(`adapter.${method} must be a function`);
    }
  }

  if (typeof adapter.version !== 'string' || adapter.version.trim().length === 0) {
    fail('adapter.version must be a non-empty string');
  }

  return adapter;
}

function normalizeInventory(entries, field) {
  if (!Array.isArray(entries)) fail(`${field} must be an array`);

  const bySlug = new Map();
  const normalized = entries.map((entry, index) => {
    if (!isPlainObject(entry)) fail(`${field}[${index}] must be an object`);
    assertSafeSlug(entry.slug, `${field}[${index}].slug`);

    const normalizedEntry = stableJson(entry, `${field}[${index}]`);
    const canonical = JSON.stringify(normalizedEntry);
    if (bySlug.has(entry.slug)) fail(`${field} contains a duplicate slug`);
    bySlug.set(entry.slug, canonical);
    return normalizedEntry;
  });

  return { entries: normalized, bySlug };
}

function sameInventory(expected, actual, field) {
  if (expected.bySlug.size !== actual.bySlug.size) {
    fail(`${field} does not match the adapter inventory`);
  }

  for (const [slug, entry] of expected.bySlug) {
    if (actual.bySlug.get(slug) !== entry) {
      fail(`${field} does not match the adapter inventory`);
    }
  }
}

function normalizeRanges(ranges, beforeLength, afterLength) {
  if (!Array.isArray(ranges) || ranges.length === 0) {
    fail('adapter candidate must declare at least one edit range');
  }

  let previousBeforeEnd = 0;
  let previousAfterEnd = 0;

  return ranges.map((range, index) => {
    if (!isPlainObject(range)) fail(`declaredEditRanges[${index}] must be an object`);

    const normalized = {};
    for (const key of ['beforeStart', 'beforeEnd', 'afterStart', 'afterEnd']) {
      const value = range[key];
      if (!Number.isInteger(value) || value < 0) {
        fail(`declaredEditRanges[${index}].${key} must be a non-negative integer`);
      }
      normalized[key] = value;
    }

    if (
      normalized.beforeStart > normalized.beforeEnd
      || normalized.afterStart > normalized.afterEnd
      || normalized.beforeEnd > beforeLength
      || normalized.afterEnd > afterLength
    ) {
      fail(`declaredEditRanges[${index}] is outside the supplied byte buffers`);
    }

    if (
      normalized.beforeStart < previousBeforeEnd
      || normalized.afterStart < previousAfterEnd
    ) {
      fail('declaredEditRanges must be ordered and non-overlapping in both byte buffers');
    }

    if (
      normalized.beforeStart === normalized.beforeEnd
      && normalized.afterStart === normalized.afterEnd
    ) {
      fail(`declaredEditRanges[${index}] cannot be empty in both byte buffers`);
    }

    previousBeforeEnd = normalized.beforeEnd;
    previousAfterEnd = normalized.afterEnd;
    return normalized;
  });
}

export function verifyDeclaredEdits(beforeValue, afterValue, declaredEditRanges) {
  const before = toBuffer(beforeValue, 'before bytes');
  const after = toBuffer(afterValue, 'after bytes');
  const ranges = normalizeRanges(declaredEditRanges, before.length, after.length);

  let beforeCursor = 0;
  let afterCursor = 0;
  let changedRangeCount = 0;

  for (const range of ranges) {
    if (!before.subarray(beforeCursor, range.beforeStart).equals(
      after.subarray(afterCursor, range.afterStart),
    )) {
      fail('adapter changed bytes outside its declared edit ranges');
    }

    if (!before.subarray(range.beforeStart, range.beforeEnd).equals(
      after.subarray(range.afterStart, range.afterEnd),
    )) {
      changedRangeCount += 1;
    }

    beforeCursor = range.beforeEnd;
    afterCursor = range.afterEnd;
  }

  if (!before.subarray(beforeCursor).equals(after.subarray(afterCursor))) {
    fail('adapter changed bytes outside its declared edit ranges');
  }

  if (changedRangeCount === 0) fail('adapter declared no actual byte changes');
  return ranges;
}

function validateCandidateResult(result, beforeBytes) {
  if (!isPlainObject(result)) fail('adapter.createCandidate must return an object');

  for (const field of ['candidateBytes', 'declaredEditRanges', 'previousEntries', 'candidateEntries']) {
    if (!(field in result)) fail(`adapter candidate is missing ${field}`);
  }

  const candidateBytes = toBuffer(result.candidateBytes, 'adapter candidateBytes');
  const ranges = verifyDeclaredEdits(beforeBytes, candidateBytes, result.declaredEditRanges);

  return {
    candidateBytes,
    declaredEditRanges: ranges,
    previousInventory: normalizeInventory(result.previousEntries, 'adapter previousEntries'),
    candidateInventory: normalizeInventory(result.candidateEntries, 'adapter candidateEntries'),
  };
}

function assertAdditiveInventory(previousInventory, candidateInventory, metadata) {
  if (previousInventory.bySlug.has(metadata.slug)) {
    fail('metadata slug already exists in the current gallery inventory');
  }

  for (const [slug, entry] of previousInventory.bySlug) {
    if (candidateInventory.bySlug.get(slug) !== entry) {
      fail('adapter changed or removed an existing gallery entry');
    }
  }

  const additions = candidateInventory.entries.filter(
    (entry) => !previousInventory.bySlug.has(entry.slug),
  );

  if (additions.length !== 1) fail('adapter must add exactly one gallery entry');
  if (additions[0].slug !== metadata.slug) {
    fail('adapter added an entry whose slug does not match metadata.slug');
  }
}

export function prepareGalleryIndex({ indexBytes, metadata, adapter }) {
  const beforeBytes = toBuffer(indexBytes, 'indexBytes');
  const validMetadata = validateMetadata(metadata);
  const validAdapter = assertAdapterContract(adapter);
  const fingerprint = validAdapter.fingerprint(Buffer.from(beforeBytes));

  if (typeof fingerprint !== 'string' || fingerprint.trim().length === 0) {
    fail('adapter.fingerprint must return a non-empty string');
  }

  const observedPrevious = normalizeInventory(
    validAdapter.inventory(Buffer.from(beforeBytes)),
    'adapter inventory',
  );
  const result = validAdapter.createCandidate({
    indexBytes: Buffer.from(beforeBytes),
    metadata: cloneJson(validMetadata),
    fingerprint,
    previousEntries: cloneJson(observedPrevious.entries),
  });

  if (result && typeof result.then === 'function') {
    fail('adapter.createCandidate must be synchronous and deterministic');
  }

  const candidate = validateCandidateResult(result, beforeBytes);
  sameInventory(observedPrevious, candidate.previousInventory, 'adapter previousEntries');
  const observedCandidate = normalizeInventory(
    validAdapter.inventory(Buffer.from(candidate.candidateBytes)),
    'adapter candidate inventory',
  );
  sameInventory(
    observedCandidate,
    candidate.candidateInventory,
    'adapter candidateEntries',
  );
  assertAdditiveInventory(observedPrevious, observedCandidate, validMetadata);

  return {
    schemaVersion: 1,
    metadata: validMetadata,
    adapterFingerprint: fingerprint,
    adapterVersion: validAdapter.version,
    previousIndexSha256: sha256(beforeBytes),
    candidateIndexSha256: sha256(candidate.candidateBytes),
    declaredEditRanges: candidate.declaredEditRanges,
    previousEntries: candidate.previousInventory.entries,
    candidateEntries: observedCandidate.entries,
    candidateBytes: candidate.candidateBytes,
  };
}
