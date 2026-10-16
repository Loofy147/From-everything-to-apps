import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createArchive,
  stringifyArchive,
  PortableArchiveError,
} from '@from-everything-to-apps/portable-archive';
import {
  RecordVault,
  RecordVaultError,
  RECORD_VAULT_APP_ID,
} from '../src/index.js';

class MemoryStorage {
  #data = new Map();
  failNextWrite = false;

  getItem(key) {
    return this.#data.has(key) ? this.#data.get(key) : null;
  }

  setItem(key, value) {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('simulated quota failure');
    }
    this.#data.set(key, String(value));
  }
}

function fixedClock() {
  let counter = 0;
  return () => new Date(Date.parse('2026-10-16T11:00:00.000Z') + counter++ * 1000);
}

function makeVault(storage = new MemoryStorage()) {
  let id = 0;
  const vault = RecordVault.open({
    storage,
    clock: fixedClock(),
    idFactory: () => `record-${++id}`,
  });
  return { vault, storage };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof RecordVaultError || error instanceof PortableArchiveError);
    assert.equal(error.code, code);
    return true;
  });
}

test('creates, updates, deletes and reloads records through the storage boundary', () => {
  const storage = new MemoryStorage();
  const first = RecordVault.open({ storage, clock: fixedClock(), idFactory: () => 'job-1' });
  const created = first.createRecord({ title: 'Repair air conditioner', notes: 'Call before arrival' });
  first.updateRecord(created.id, { status: 'in_progress', notes: 'Part ordered' });

  const reloaded = RecordVault.open({ storage, clock: fixedClock(), idFactory: () => 'unused' });
  assert.equal(reloaded.getRecord('job-1').status, 'in_progress');
  assert.equal(reloaded.getRecord('job-1').notes, 'Part ordered');
  reloaded.deleteRecord('job-1');
  assert.deepEqual(RecordVault.open({ storage }).listRecords(), []);
});

test('returns copies so callers cannot mutate the stored in-memory state', () => {
  const { vault } = makeVault();
  const record = vault.createRecord({ title: 'Prepare quotation' });
  record.title = 'changed outside';
  const list = vault.listRecords();
  list[0].title = 'also changed outside';
  assert.equal(vault.getRecord('record-1').title, 'Prepare quotation');
});

test('exports a portable archive and imports it into a separate vault', async () => {
  const source = makeVault().vault;
  source.createRecord({ title: 'Client visit', notes: 'Check spare part', status: 'done' });
  const archive = await source.exportArchive({ metadata: { locale: 'fr-DZ' } });
  const text = await stringifyArchive(archive);
  const target = makeVault().vault;
  target.createRecord({ title: 'Temporary target record' });

  const result = await target.importArchive(text);
  assert.deepEqual(result, { imported: 1, changed: true });
  assert.deepEqual(target.listRecords(), source.listRecords());
});

test('rejects tampered archives without replacing stored or in-memory data', async () => {
  const { vault, storage } = makeVault();
  vault.createRecord({ title: 'Must survive invalid import' });
  const beforeStorage = storage.getItem('from-everything-to-apps.record-vault');
  const beforeRecords = vault.listRecords();

  const corrupt = await vault.exportArchive();
  corrupt.data.records[0].title = 'tampered';
  await expectCode(vault.importArchive(corrupt), 'archive-integrity-mismatch');

  assert.deepEqual(vault.listRecords(), beforeRecords);
  assert.equal(storage.getItem('from-everything-to-apps.record-vault'), beforeStorage);
});

test('rejects domain-invalid but correctly checksummed archives without overwriting records', async () => {
  const { vault, storage } = makeVault();
  vault.createRecord({ title: 'Existing record' });
  const beforeStorage = storage.getItem('from-everything-to-apps.record-vault');
  const invalid = await createArchive({
    appId: RECORD_VAULT_APP_ID,
    schemaVersion: 2,
    data: { records: [{ id: 'bad id', title: '', notes: '', status: 'unknown', createdAt: 'bad', updatedAt: 'bad' }] },
  });
  await expectCode(vault.importArchive(invalid), 'archive-invalid-data');
  assert.equal(storage.getItem('from-everything-to-apps.record-vault'), beforeStorage);
  assert.equal(vault.listRecords()[0].title, 'Existing record');
});

test('rejects wrong-app and unsupported future archives without overwriting data', async () => {
  const { vault, storage } = makeVault();
  vault.createRecord({ title: 'Keep current record' });
  const before = storage.getItem('from-everything-to-apps.record-vault');
  const wrongApp = await createArchive({ appId: 'other-app', schemaVersion: 2, data: { records: [] } });
  await expectCode(vault.importArchive(wrongApp), 'archive-app-mismatch');
  const future = await createArchive({ appId: RECORD_VAULT_APP_ID, schemaVersion: 3, data: { records: [] } });
  await expectCode(vault.importArchive(future), 'archive-unsupported-schema-version');
  assert.equal(storage.getItem('from-everything-to-apps.record-vault'), before);
});

test('migrates a v1 archive to current records schema', async () => {
  const legacy = await createArchive({
    appId: RECORD_VAULT_APP_ID,
    schemaVersion: 1,
    exportedAt: '2026-10-16T11:00:00.000Z',
    data: { records: [{ id: 'legacy-1', title: 'Legacy work item', createdAt: '2026-10-16T10:00:00.000Z', updatedAt: '2026-10-16T10:30:00.000Z' }] },
  });
  const { vault } = makeVault();
  const result = await vault.importArchive(legacy);
  assert.deepEqual(result, { imported: 1, changed: true });
  assert.deepEqual(vault.getRecord('legacy-1'), {
    id: 'legacy-1',
    title: 'Legacy work item',
    notes: '',
    status: 'open',
    createdAt: '2026-10-16T10:00:00.000Z',
    updatedAt: '2026-10-16T10:30:00.000Z',
  });
});

test('migrates valid v1 local storage on open, but refuses corrupt storage without replacing it', () => {
  const storage = new MemoryStorage();
  const legacyText = JSON.stringify({
    schemaVersion: 1,
    records: [{ id: 'legacy-2', title: 'Legacy local record', createdAt: '2026-10-16T10:00:00.000Z', updatedAt: '2026-10-16T10:30:00.000Z' }],
  });
  storage.setItem('from-everything-to-apps.record-vault', legacyText);
  const vault = RecordVault.open({ storage });
  assert.equal(vault.getRecord('legacy-2').status, 'open');
  assert.equal(JSON.parse(storage.getItem('from-everything-to-apps.record-vault')).schemaVersion, 2);

  storage.setItem('from-everything-to-apps.record-vault', '{broken');
  const before = storage.getItem('from-everything-to-apps.record-vault');
  assert.throws(() => RecordVault.open({ storage }), (error) => error.code === 'corrupt-storage');
  assert.equal(storage.getItem('from-everything-to-apps.record-vault'), before);
});

test('storage write failure leaves in-memory state unchanged', () => {
  const { vault, storage } = makeVault();
  const before = vault.listRecords();
  storage.failNextWrite = true;
  assert.throws(() => vault.createRecord({ title: 'Do not publish after failed save' }), (error) => error.code === 'storage-write-failed');
  assert.deepEqual(vault.listRecords(), before);
});

test('rejects duplicate ids, invalid updates and missing record ids', () => {
  const { vault } = makeVault();
  vault.createRecord({ id: 'fixed', title: 'Existing' });
  assert.throws(() => vault.createRecord({ id: 'fixed', title: 'Duplicate' }), (error) => error.code === 'duplicate-id');
  assert.throws(() => vault.updateRecord('fixed', { id: 'new-id' }), (error) => error.code === 'invalid-input');
  assert.throws(() => vault.updateRecord('missing', { title: 'Nope' }), (error) => error.code === 'not-found');
});
