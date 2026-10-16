import {
  createArchive,
  parseArchive,
  PortableArchiveError,
} from '@from-everything-to-apps/portable-archive';

export const RECORD_VAULT_APP_ID = 'record-vault';
export const RECORD_SCHEMA_VERSION = 2;
export const DEFAULT_STORAGE_KEY = 'from-everything-to-apps.record-vault';
const STATUS_VALUES = new Set(['open', 'in_progress', 'done']);
const CURRENT_RECORD_KEYS = new Set(['id', 'title', 'notes', 'status', 'createdAt', 'updatedAt']);
const V1_RECORD_KEYS = new Set(['id', 'title', 'createdAt', 'updatedAt']);
const STATE_V2_KEYS = new Set(['schemaVersion', 'records']);
const ARCHIVE_DATA_KEYS = new Set(['records']);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export class RecordVaultError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'RecordVaultError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new RecordVaultError(code, message, cause ? { cause } : undefined);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, keys, label) {
  if (!isPlainObject(value)) fail('invalid-data', `${label} must be a plain object.`);
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) fail('invalid-data', `Unsupported ${label} field: ${key}.`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) fail('invalid-data', `Missing ${label} field: ${key}.`);
  }
}

function assertUtcTimestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    fail('invalid-data', `${label} must be a UTC ISO timestamp.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== value) {
    fail('invalid-data', `${label} must be a real UTC timestamp.`);
  }
}

function normalizeRecord(record, schemaVersion = RECORD_SCHEMA_VERSION) {
  const keys = schemaVersion === 1 ? V1_RECORD_KEYS : CURRENT_RECORD_KEYS;
  assertExactKeys(record, keys, 'record');
  if (typeof record.id !== 'string' || !ID_PATTERN.test(record.id)) {
    fail('invalid-data', 'Record id must be a non-empty safe identifier of at most 128 characters.');
  }
  if (typeof record.title !== 'string' || record.title.trim().length < 1 || record.title.length > 200) {
    fail('invalid-data', 'Record title must contain 1–200 characters.');
  }
  assertUtcTimestamp(record.createdAt, 'createdAt');
  assertUtcTimestamp(record.updatedAt, 'updatedAt');
  if (record.updatedAt < record.createdAt) fail('invalid-data', 'updatedAt cannot precede createdAt.');

  if (schemaVersion === 1) {
    return {
      id: record.id,
      title: record.title.trim(),
      notes: '',
      status: 'open',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  if (typeof record.notes !== 'string' || record.notes.length > 20_000) {
    fail('invalid-data', 'Record notes must be text of at most 20,000 characters.');
  }
  if (!STATUS_VALUES.has(record.status)) fail('invalid-data', 'Record status must be open, in_progress, or done.');
  return {
    id: record.id,
    title: record.title.trim(),
    notes: record.notes,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function normalizeRecords(records, schemaVersion = RECORD_SCHEMA_VERSION) {
  if (!Array.isArray(records)) fail('invalid-data', 'records must be an array.');
  if (records.length > 50_000) fail('invalid-data', 'The record limit of 50,000 was exceeded.');
  const seen = new Set();
  const normalized = records.map((record) => {
    const item = normalizeRecord(record, schemaVersion);
    if (seen.has(item.id)) fail('invalid-data', `Duplicate record id: ${item.id}.`);
    seen.add(item.id);
    return item;
  });
  return normalized;
}

function normalizeArchiveData(data, schemaVersion = RECORD_SCHEMA_VERSION) {
  assertExactKeys(data, ARCHIVE_DATA_KEYS, 'archive data');
  return { records: normalizeRecords(data.records, schemaVersion) };
}

function migrateV1Records(records) {
  return normalizeRecords(records, 1);
}

function parseStoredState(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail('corrupt-storage', 'Saved record data is not valid JSON; it was left untouched.', error);
  }

  if (!isPlainObject(parsed) || !Number.isSafeInteger(parsed.schemaVersion)) {
    fail('corrupt-storage', 'Saved record data has an invalid envelope; it was left untouched.');
  }

  if (parsed.schemaVersion === 1) {
    assertExactKeys(parsed, STATE_V2_KEYS, 'stored state');
    return { schemaVersion: RECORD_SCHEMA_VERSION, records: migrateV1Records(parsed.records) };
  }
  if (parsed.schemaVersion !== RECORD_SCHEMA_VERSION) {
    fail('unsupported-storage-version', `Saved record schema version ${String(parsed.schemaVersion)} is unsupported; existing data was left untouched.`);
  }

  assertExactKeys(parsed, STATE_V2_KEYS, 'stored state');
  return { schemaVersion: RECORD_SCHEMA_VERSION, records: normalizeRecords(parsed.records) };
}

function toStorageText(state) {
  return JSON.stringify({ schemaVersion: RECORD_SCHEMA_VERSION, records: state.records });
}

function cloneRecord(record) {
  return { ...record };
}

/**
 * A local-first record store. The supplied storage must implement the Web Storage
 * getItem/setItem interface. One key is replaced per commit; cross-tab conflict
 * resolution and encrypted storage are intentionally not provided here.
 */
export class RecordVault {
  #storage;
  #storageKey;
  #clock;
  #idFactory;
  #state;

  constructor({ storage, storageKey = DEFAULT_STORAGE_KEY, clock = () => new Date(), idFactory } = {}) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      fail('invalid-options', 'storage must implement getItem(key) and setItem(key, value).');
    }
    if (typeof storageKey !== 'string' || storageKey.length < 1 || storageKey.length > 200) {
      fail('invalid-options', 'storageKey must contain 1–200 characters.');
    }
    this.#storage = storage;
    this.#storageKey = storageKey;
    this.#clock = clock;
    this.#idFactory = idFactory ?? (() => {
      if (typeof globalThis.crypto?.randomUUID !== 'function') {
        fail('crypto-unavailable', 'A crypto.randomUUID implementation is required to create record IDs.');
      }
      return globalThis.crypto.randomUUID();
    });
    this.#state = { schemaVersion: RECORD_SCHEMA_VERSION, records: [] };
  }

  static open(options = {}) {
    const vault = new RecordVault(options);
    let stored;
    try {
      stored = vault.#storage.getItem(vault.#storageKey);
    } catch (error) {
      fail('storage-read-failed', 'Could not read saved records.', error);
    }

    if (stored === null || stored === undefined) {
      const initial = { schemaVersion: RECORD_SCHEMA_VERSION, records: [] };
      vault.#writeState(initial);
      vault.#state = initial;
      return vault;
    }

    if (typeof stored !== 'string') fail('corrupt-storage', 'Saved record data must be text; existing data was left untouched.');
    const parsed = parseStoredState(stored);
    // Rewrite only a valid state, and persist schema migration before returning.
    if (!stored.startsWith('{"schemaVersion":2,')) vault.#writeState(parsed);
    vault.#state = parsed;
    return vault;
  }

  #writeState(nextState) {
    const text = toStorageText(nextState);
    try {
      this.#storage.setItem(this.#storageKey, text);
    } catch (error) {
      fail('storage-write-failed', 'Could not save records; in-memory state was not advanced.', error);
    }
  }

  #commit(records) {
    const nextState = { schemaVersion: RECORD_SCHEMA_VERSION, records: normalizeRecords(records) };
    // Publish to memory only after storage confirms the single-key write succeeded.
    this.#writeState(nextState);
    this.#state = nextState;
  }

  listRecords() {
    return this.#state.records.map(cloneRecord);
  }

  getRecord(id) {
    const record = this.#state.records.find((item) => item.id === id);
    return record ? cloneRecord(record) : null;
  }

  createRecord({ id, title, notes = '', status = 'open' } = {}) {
    const now = this.#clock().toISOString();
    const record = normalizeRecord({
      id: id ?? this.#idFactory(),
      title,
      notes,
      status,
      createdAt: now,
      updatedAt: now,
    });
    if (this.#state.records.some((item) => item.id === record.id)) {
      fail('duplicate-id', `A record with id ${record.id} already exists.`);
    }
    this.#commit([...this.#state.records, record]);
    return cloneRecord(record);
  }

  updateRecord(id, patch = {}) {
    if (!isPlainObject(patch)) fail('invalid-input', 'Record updates must be a plain object.');
    const allowed = new Set(['title', 'notes', 'status']);
    for (const key of Object.keys(patch)) {
      if (!allowed.has(key)) fail('invalid-input', `Field cannot be updated: ${key}.`);
    }
    const existing = this.#state.records.find((item) => item.id === id);
    if (!existing) fail('not-found', `Record not found: ${id}.`);
    const updated = normalizeRecord({
      ...existing,
      ...patch,
      updatedAt: this.#clock().toISOString(),
    });
    this.#commit(this.#state.records.map((item) => item.id === id ? updated : item));
    return cloneRecord(updated);
  }

  deleteRecord(id) {
    const index = this.#state.records.findIndex((item) => item.id === id);
    if (index < 0) fail('not-found', `Record not found: ${id}.`);
    this.#commit(this.#state.records.filter((item) => item.id !== id));
  }

  async exportArchive({ metadata = {} } = {}) {
    return createArchive({
      appId: RECORD_VAULT_APP_ID,
      schemaVersion: RECORD_SCHEMA_VERSION,
      data: { records: this.#state.records },
      metadata: { purpose: 'record-vault-backup', ...metadata },
    });
  }

  async importArchive(input) {
    let restored;
    try {
      restored = await parseArchive(input, {
        expectedAppId: RECORD_VAULT_APP_ID,
        targetSchemaVersion: RECORD_SCHEMA_VERSION,
        migrations: {
          1: (data) => normalizeArchiveData({ records: migrateV1Records(data?.records) }, 2),
        },
        validateData: (data) => {
          normalizeArchiveData(data, RECORD_SCHEMA_VERSION);
          return true;
        },
      });
    } catch (error) {
      if (error instanceof PortableArchiveError) {
        fail(`archive-${error.code}`, `Archive import rejected: ${error.message}`, error);
      }
      throw error;
    }

    // Full format, integrity, migration and domain validation have completed.
    // Validate into a fresh state before the only storage write.
    const nextState = {
      schemaVersion: RECORD_SCHEMA_VERSION,
      records: normalizeArchiveData(restored.data, RECORD_SCHEMA_VERSION).records,
    };
    const before = toStorageText(this.#state);
    const after = toStorageText(nextState);
    if (before === after) return { imported: nextState.records.length, changed: false };

    this.#writeState(nextState);
    this.#state = nextState;
    return { imported: nextState.records.length, changed: true };
  }
}

/** Construct an explicit browser LocalStorage adapter; call in a browser context. */
export function createLocalStorageAdapter(storage = globalThis.localStorage) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    fail('invalid-options', 'Browser localStorage is unavailable; pass an explicit Storage-compatible object.');
  }
  return storage;
}
