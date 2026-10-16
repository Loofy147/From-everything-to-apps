import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCHIVE_FORMAT,
  createArchive,
  parseArchive,
  stringifyArchive,
  PortableArchiveError,
} from '../src/index.js';

const fixedTime = '2026-10-16T11:00:00.000Z';
const sample = () => ({
  appId: 'personal-workspace',
  schemaVersion: 1,
  exportedAt: fixedTime,
  metadata: { locale: 'fr-DZ', purpose: 'backup' },
  data: {
    projects: [{ id: 'p1', title: 'Renew workshop inventory', done: false }],
    preferences: { theme: 'system', currency: 'DZD' },
  },
});

async function makeSample() {
  return createArchive(sample());
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof PortableArchiveError);
    assert.equal(error.code, code);
    return true;
  });
}

test('creates a versioned envelope with integrity metadata and round-trips it', async () => {
  const archive = await makeSample();
  assert.equal(archive.format, ARCHIVE_FORMAT);
  assert.equal(archive.formatVersion, 1);
  assert.equal(archive.integrity.algorithm, 'SHA-256');
  assert.match(archive.integrity.digest, /^[a-f0-9]{64}$/);

  const text = await stringifyArchive(archive);
  const restored = await parseArchive(text, { expectedAppId: 'personal-workspace' });
  assert.deepEqual(restored.data, sample().data);
  assert.equal(restored.schemaVersion, 1);
  assert.equal(restored.migrated, false);
});

test('canonical digest does not depend on object key insertion order', async () => {
  const first = await createArchive({ appId: 'demo', schemaVersion: 1, exportedAt: fixedTime, data: { z: 1, a: { y: 2, b: 3 } } });
  const second = await createArchive({ appId: 'demo', schemaVersion: 1, exportedAt: fixedTime, data: { a: { b: 3, y: 2 }, z: 1 } });
  assert.equal(first.integrity.digest, second.integrity.digest);
});

test('detects content modification', async () => {
  const archive = await makeSample();
  archive.data.projects[0].title = 'tampered';
  await expectCode(parseArchive(archive), 'integrity-mismatch');
});

test('rejects files for another application', async () => {
  await expectCode(parseArchive(await makeSample(), { expectedAppId: 'khidma-desk' }), 'app-mismatch');
});

test('rejects malformed JSON, unsupported formats, and unsupported versions', async () => {
  await expectCode(parseArchive('{'), 'invalid-json');
  const archive = await makeSample();
  archive.format = 'other-format';
  await expectCode(parseArchive(archive), 'unsupported-format');
  const future = await makeSample();
  future.formatVersion = 2;
  await expectCode(parseArchive(future), 'unsupported-format-version');
});

test('enforces the import size limit before parsing', async () => {
  await expectCode(parseArchive(' '.repeat(1025), { maxBytes: 1000 }), 'archive-too-large');
});

test('rejects unsafe object keys, accessors, cycles, and non-JSON values', async () => {
  const unsafe = JSON.parse('{"__proto__":{"polluted":true}}');
  await expectCode(createArchive({ appId: 'demo', schemaVersion: 1, exportedAt: fixedTime, data: unsafe }), 'invalid-data');

  const accessor = {};
  Object.defineProperty(accessor, 'secret', { enumerable: true, get() { throw new Error('must not execute'); } });
  await expectCode(createArchive({ appId: 'demo', schemaVersion: 1, exportedAt: fixedTime, data: accessor }), 'invalid-data');

  const cycle = {}; cycle.self = cycle;
  await expectCode(createArchive({ appId: 'demo', schemaVersion: 1, exportedAt: fixedTime, data: cycle }), 'invalid-data');
  await expectCode(createArchive({ appId: 'demo', schemaVersion: 1, exportedAt: fixedTime, data: { amount: Number.NaN } }), 'invalid-data');
});

test('migrates schema versions sequentially and validates after migration', async () => {
  const archive = await createArchive({
    appId: 'demo', schemaVersion: 1, exportedAt: fixedTime,
    data: { name: 'Workshop', count: 3 },
  });
  const restored = await parseArchive(archive, {
    targetSchemaVersion: 3,
    migrations: {
      1: (old) => ({ ...old, label: old.name, count: old.count }),
      2: (old) => ({ label: old.label, quantity: old.count }),
    },
    validateData: (data) => typeof data.quantity === 'number' && typeof data.label === 'string',
  });
  assert.deepEqual(restored.data, { label: 'Workshop', quantity: 3 });
  assert.equal(restored.sourceSchemaVersion, 1);
  assert.equal(restored.schemaVersion, 3);
  assert.equal(restored.migrated, true);
});

test('fails closed on missing migrations, future schemas, and invalid application data', async () => {
  const archive = await createArchive({ appId: 'demo', schemaVersion: 2, exportedAt: fixedTime, data: { count: 1 } });
  await expectCode(parseArchive(archive, { targetSchemaVersion: 3 }), 'missing-migration');
  await expectCode(parseArchive(archive, { targetSchemaVersion: 1 }), 'unsupported-schema-version');
  await expectCode(parseArchive(archive, { validateData: () => false }), 'invalid-data');
});

test('rejects invalid timestamps and unsafe app IDs', async () => {
  await expectCode(createArchive({ appId: 'Uppercase', schemaVersion: 1, exportedAt: fixedTime, data: {} }), 'invalid-envelope');
  await expectCode(createArchive({ appId: 'demo', schemaVersion: 1, exportedAt: 'yesterday', data: {} }), 'invalid-envelope');
});

test('serialization validates the supplied envelope and caps the serialized bytes', async () => {
  const archive = await makeSample();
  await expectCode(stringifyArchive({ ...archive, extra: true }), 'unsupported-field');
  await expectCode(stringifyArchive(archive, { maxBytes: 100 }), 'archive-too-large');
});

test('rejects missing required fields and unknown envelope fields', async () => {
  const archive = await makeSample();
  const { integrity, ...missingIntegrity } = archive;
  await expectCode(parseArchive(missingIntegrity), 'invalid-envelope');
  await expectCode(parseArchive({ ...archive, unexpected: 'field' }), 'unsupported-field');
});

test('does not retain caller-owned references and rejects sparse arrays', async () => {
  const data = { nested: { title: 'before' } };
  const archive = await createArchive({ appId: 'demo', schemaVersion: 1, exportedAt: fixedTime, data });
  data.nested.title = 'after';
  assert.equal((await parseArchive(archive)).data.nested.title, 'before');

  const sparse = [];
  sparse.length = 2;
  sparse[1] = 'present';
  await expectCode(createArchive({ appId: 'demo', schemaVersion: 1, exportedAt: fixedTime, data: sparse }), 'invalid-data');
});

test('wraps migration exceptions and rejects invalid migration options', async () => {
  const archive = await createArchive({ appId: 'demo', schemaVersion: 1, exportedAt: fixedTime, data: { n: 1 } });
  await expectCode(parseArchive(archive, { targetSchemaVersion: 2, migrations: { 1: () => { throw new Error('boom'); } } }), 'migration-failed');
  await expectCode(parseArchive(archive, { migrations: [] }), 'invalid-options');
});
