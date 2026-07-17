import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  GalleryValidationError,
  prepareGalleryIndex,
  sha256,
  validateMetadata,
} from '../../scripts/explainers/gallery-index.mjs';

const fixtureBytes = await readFile(
  new URL('../fixtures/explainers/generic-index.html', import.meta.url),
);

function metadata(overrides = {}) {
  return {
    schemaVersion: 1,
    slug: 'new-entry',
    title: 'Neutral title',
    summary: 'Neutral summary',
    createdAt: '2026-07-17T00:00:00.000Z',
    artifactSha256: sha256(Buffer.from('neutral artifact')),
    ...overrides,
  };
}

function fingerprint(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function inventory(bytes) {
  const entries = [{ slug: 'existing-entry', note: 'opaque prior entry' }];
  const match = bytes.toString('utf8').match(/\nFAKE_ENTRY:([a-z0-9-]+)\n/g) ?? [];
  return [
    ...entries,
    ...match.map((line) => ({ slug: line.slice('\nFAKE_ENTRY:'.length, -1), note: 'fake addition' })),
  ];
}

function fakeAdapter(overrides = {}) {
  return {
    version: 'fake-adapter-v1',
    fingerprint,
    inventory,
    createCandidate({ indexBytes, metadata: entry }) {
      const addition = Buffer.from(`\nFAKE_ENTRY:${entry.slug}\n`);
      const candidateBytes = Buffer.concat([indexBytes, addition]);
      return {
        candidateBytes,
        declaredEditRanges: [{
          beforeStart: indexBytes.length,
          beforeEnd: indexBytes.length,
          afterStart: indexBytes.length,
          afterEnd: candidateBytes.length,
        }],
        previousEntries: inventory(indexBytes),
        candidateEntries: inventory(candidateBytes),
      };
    },
    ...overrides,
  };
}

test('generic fixture is opaque and the fake adapter produces one additive entry', () => {
  assert.doesNotMatch(fixtureBytes.toString('utf8'), /href=|<a\b|card|anchor/i);

  const prepared = prepareGalleryIndex({
    indexBytes: fixtureBytes,
    metadata: metadata(),
    adapter: fakeAdapter(),
  });

  assert.equal(prepared.previousEntries.length, 1);
  assert.deepEqual(prepared.candidateEntries.map((entry) => entry.slug), [
    'existing-entry',
    'new-entry',
  ]);
  assert.equal(prepared.candidateIndexSha256, sha256(prepared.candidateBytes));
});

test('metadata rejects unsafe slugs and malformed schema fields', () => {
  assert.throws(
    () => validateMetadata(metadata({ slug: '../outside' })),
    GalleryValidationError,
  );
  assert.throws(
    () => validateMetadata(metadata({ createdAt: '2026-07-17' })),
    GalleryValidationError,
  );
  assert.throws(
    () => validateMetadata({ ...metadata(), arbitraryGalleryUrl: 'https://example.invalid/' }),
    GalleryValidationError,
  );
});

test('adapter contract and candidate result validation fail closed', () => {
  assert.throws(
    () => prepareGalleryIndex({
      indexBytes: fixtureBytes,
      metadata: metadata(),
      adapter: { version: 'missing-methods' },
    }),
    /adapter\.fingerprint/,
  );

  assert.throws(
    () => prepareGalleryIndex({
      indexBytes: fixtureBytes,
      metadata: metadata(),
      adapter: fakeAdapter({
        createCandidate() {
          return { candidateBytes: Buffer.from('wrong') };
        },
      }),
    }),
    /missing declaredEditRanges/,
  );

  assert.throws(
    () => prepareGalleryIndex({
      indexBytes: fixtureBytes,
      metadata: metadata(),
      adapter: fakeAdapter({ fingerprint: () => '' }),
    }),
    /fingerprint must return/,
  );
});

test('undeclared byte changes are rejected even when the candidate inventory is additive', () => {
  const adapter = fakeAdapter({
    createCandidate({ indexBytes, metadata: entry }) {
      const candidateBytes = Buffer.concat([
        Buffer.from(`!${indexBytes.subarray(1).toString('utf8')}`),
        Buffer.from(`\nFAKE_ENTRY:${entry.slug}\n`),
      ]);
      return {
        candidateBytes,
        declaredEditRanges: [{
          beforeStart: indexBytes.length,
          beforeEnd: indexBytes.length,
          afterStart: indexBytes.length,
          afterEnd: candidateBytes.length,
        }],
        previousEntries: inventory(indexBytes),
        candidateEntries: inventory(candidateBytes),
      };
    },
  });

  assert.throws(
    () => prepareGalleryIndex({ indexBytes: fixtureBytes, metadata: metadata(), adapter }),
    /outside its declared edit ranges/,
  );
});

test('adapter cannot change or remove prior entries', () => {
  for (const candidateEntries of [
    [{ slug: 'new-entry', note: 'fake addition' }],
    [
      { slug: 'existing-entry', note: 'changed prior entry' },
      { slug: 'new-entry', note: 'fake addition' },
    ],
  ]) {
    assert.throws(
      () => prepareGalleryIndex({
        indexBytes: fixtureBytes,
        metadata: metadata(),
        adapter: fakeAdapter({
          createCandidate({ indexBytes, metadata: entry }) {
            const candidateBytes = Buffer.concat([indexBytes, Buffer.from(`\nFAKE_ENTRY:${entry.slug}\n`)]);
            return {
              candidateBytes,
              declaredEditRanges: [{
                beforeStart: indexBytes.length,
                beforeEnd: indexBytes.length,
                afterStart: indexBytes.length,
                afterEnd: candidateBytes.length,
              }],
              previousEntries: inventory(indexBytes),
              candidateEntries,
            };
          },
        }),
      }),
      /candidateEntries does not match|changed or removed/,
    );
  }
});

test('adapter cannot lie about the inventory it claims for candidate bytes', () => {
  const adapter = fakeAdapter({
    createCandidate({ indexBytes, metadata: entry }) {
      const candidateBytes = Buffer.concat([indexBytes, Buffer.from(`\nFAKE_ENTRY:${entry.slug}\n`)]);
      return {
        candidateBytes,
        declaredEditRanges: [{
          beforeStart: indexBytes.length,
          beforeEnd: indexBytes.length,
          afterStart: indexBytes.length,
          afterEnd: candidateBytes.length,
        }],
        previousEntries: inventory(indexBytes),
        candidateEntries: [
          ...inventory(indexBytes),
          { slug: entry.slug, note: 'claimed addition' },
          { slug: 'unobserved-entry', note: 'claimed but absent' },
        ],
      };
    },
  });

  assert.throws(
    () => prepareGalleryIndex({ indexBytes: fixtureBytes, metadata: metadata(), adapter }),
    /candidateEntries does not match/,
  );
});

test('adapter rejects duplicate additions and an unsafe inventory slug', () => {
  const duplicateAdapter = fakeAdapter({
    createCandidate({ indexBytes, metadata: entry }) {
      const candidateBytes = Buffer.concat([indexBytes, Buffer.from(`\nFAKE_ENTRY:${entry.slug}\n`)]);
      return {
        candidateBytes,
        declaredEditRanges: [{
          beforeStart: indexBytes.length,
          beforeEnd: indexBytes.length,
          afterStart: indexBytes.length,
          afterEnd: candidateBytes.length,
        }],
        previousEntries: inventory(indexBytes),
        candidateEntries: [
          ...inventory(indexBytes),
          { slug: entry.slug, note: 'first addition' },
          { slug: entry.slug, note: 'duplicate addition' },
        ],
      };
    },
  });

  assert.throws(
    () => prepareGalleryIndex({ indexBytes: fixtureBytes, metadata: metadata(), adapter: duplicateAdapter }),
    /duplicate slug/,
  );

  assert.throws(
    () => prepareGalleryIndex({
      indexBytes: fixtureBytes,
      metadata: metadata(),
      adapter: fakeAdapter({ inventory: () => [{ slug: '../unsafe' }] }),
    }),
    /lowercase, hyphen-separated slug/,
  );
});
