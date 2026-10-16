/**
 * A small, browser-compatible portable archive contract.
 * SHA-256 detects accidental or unsupported modification; it is not a signature.
 */

export const ARCHIVE_FORMAT = 'from-everything-to-apps/portable-archive';
export const ARCHIVE_FORMAT_VERSION = 1;
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
export const MAX_ALLOWED_BYTES = 100 * 1024 * 1024;

const APP_ID_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/;
const ENVELOPE_KEYS = new Set([
  'format', 'formatVersion', 'appId', 'schemaVersion', 'exportedAt', 'metadata', 'data', 'integrity',
]);
const INTEGRITY_KEYS = new Set(['algorithm', 'digest']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export class PortableArchiveError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'PortableArchiveError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new PortableArchiveError(code, message, cause ? { cause } : undefined);
}

function validateMaxBytes(maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_ALLOWED_BYTES) {
    fail('invalid-options', `maxBytes must be an integer between 1 and ${MAX_ALLOWED_BYTES}.`);
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeJsonValue(value, state = { nodes: 0, active: new WeakSet() }, depth = 0, path = '$') {
  state.nodes += 1;
  if (state.nodes > 100_000) fail('invalid-data', 'Archive data exceeds the 100,000-node limit.');
  if (depth > 100) fail('invalid-data', `Archive data exceeds the maximum nesting depth at ${path}.`);

  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('invalid-data', `Non-finite number at ${path} is not supported.`);
    return value;
  }
  if (typeof value !== 'object') {
    fail('invalid-data', `Value at ${path} is not JSON-compatible.`);
  }

  if (state.active.has(value)) fail('invalid-data', `Cyclic references are not supported at ${path}.`);
  state.active.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value).filter((key) => key !== 'length');
      for (const key of ownKeys) {
        if (typeof key !== 'string') fail('invalid-data', `Symbol properties are not supported at ${path}.`);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable) fail('invalid-data', `Non-enumerable array properties are not supported at ${path}.${key}.`);
        if (!/^(0|[1-9]\\d*)$/.test(key) || Number(key) >= value.length) {
          fail('invalid-data', `Custom array properties are not supported at ${path}.`);
        }
      }
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) fail('invalid-data', `Sparse arrays are not supported at ${path}[${index}].`);
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail('invalid-data', `Accessors are not supported at ${path}[${index}].`);
        result.push(normalizeJsonValue(descriptor.value, state, depth + 1, `${path}[${index}]`));
      }
      return result;
    }

    if (!isPlainObject(value)) fail('invalid-data', `Only plain objects are supported at ${path}.`);
    const ownKeys = Reflect.ownKeys(value);
    for (const key of ownKeys) {
      if (typeof key !== 'string') fail('invalid-data', `Symbol properties are not supported at ${path}.`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable) fail('invalid-data', `Non-enumerable properties are not supported at ${path}.${key}.`);
    }
    const result = {};
    const keys = Object.keys(value).sort();
    for (const key of keys) {
      if (FORBIDDEN_KEYS.has(key)) fail('invalid-data', `Forbidden object key at ${path}.${key}.`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) fail('invalid-data', `Accessors are not supported at ${path}.${key}.`);
      result[key] = normalizeJsonValue(descriptor.value, state, depth + 1, `${path}.${key}`);
    }
    return result;
  } finally {
    state.active.delete(value);
  }
}

function canonicalStringify(value) {
  return JSON.stringify(normalizeJsonValue(value));
}

function cloneJson(value) {
  return JSON.parse(canonicalStringify(value));
}

function validateAppId(appId) {
  if (typeof appId !== 'string' || !APP_ID_PATTERN.test(appId)) {
    fail('invalid-envelope', 'appId must be a lowercase slug containing letters, numbers, dots, or hyphens.');
  }
}

function validatePositiveVersion(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('invalid-envelope', `${label} must be a positive integer.`);
  }
}

function validateIsoUtc(value) {
  if (typeof value !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/.test(value)) {
    fail('invalid-envelope', 'exportedAt must be a UTC ISO timestamp with milliseconds.');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    fail('invalid-envelope', 'exportedAt is not a valid UTC timestamp.');
  }
}

function validateExactKeys(value, expected, label) {
  if (!isPlainObject(value)) fail('invalid-envelope', `${label} must be an object.`);
  const actual = Object.keys(value);
  for (const key of actual) {
    if (!expected.has(key)) fail('unsupported-field', `Unknown ${label} field: ${key}.`);
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) fail('invalid-envelope', `Missing ${label} field: ${key}.`);
  }
}

function utf8Length(text) {
  return new TextEncoder().encode(text).byteLength;
}

async function sha256Hex(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') {
    fail('crypto-unavailable', 'Web Crypto SHA-256 is required; use a modern browser secure context or supported Node.js runtime.');
  }
  const bytes = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bodyOf(envelope) {
  return {
    format: envelope.format,
    formatVersion: envelope.formatVersion,
    appId: envelope.appId,
    schemaVersion: envelope.schemaVersion,
    exportedAt: envelope.exportedAt,
    metadata: envelope.metadata,
    data: envelope.data,
  };
}

/** Create a portable archive envelope. No application or vendor SDK is required. */
export async function createArchive({
  appId,
  schemaVersion,
  data,
  exportedAt = new Date().toISOString(),
  metadata = {},
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  validateMaxBytes(maxBytes);
  validateAppId(appId);
  validatePositiveVersion(schemaVersion, 'schemaVersion');
  validateIsoUtc(exportedAt);
  if (!isPlainObject(metadata)) fail('invalid-envelope', 'metadata must be a plain object.');

  const body = {
    format: ARCHIVE_FORMAT,
    formatVersion: ARCHIVE_FORMAT_VERSION,
    appId,
    schemaVersion,
    exportedAt,
    metadata: cloneJson(metadata),
    data: cloneJson(data),
  };
  const digest = await sha256Hex(canonicalStringify(body));
  const envelope = { ...body, integrity: { algorithm: 'SHA-256', digest } };
  const serialized = `${JSON.stringify(envelope, null, 2)}\\n`;
  if (utf8Length(serialized) > maxBytes) fail('archive-too-large', `Archive exceeds the ${maxBytes}-byte limit.`);
  return envelope;
}

async function normalizeAndVerify(input, maxBytes) {
  validateMaxBytes(maxBytes);
  let parsed;
  if (typeof input === 'string') {
    if (utf8Length(input) > maxBytes) fail('archive-too-large', `Archive exceeds the ${maxBytes}-byte limit.`);
    try {
      parsed = JSON.parse(input);
    } catch (error) {
      fail('invalid-json', 'Archive is not valid JSON.', error);
    }
  } else {
    parsed = input;
  }

  // Canonicalization creates a safe snapshot and rejects class instances, accessors,
  // cycles, dangerous keys, unsupported values, excessive depth, and sparse arrays.
  const canonicalInput = canonicalStringify(parsed);
  if (utf8Length(canonicalInput) > maxBytes) fail('archive-too-large', `Archive exceeds the ${maxBytes}-byte limit.`);
  let envelope;
  try {
    envelope = JSON.parse(canonicalInput);
  } catch (error) {
    fail('invalid-json', 'Archive could not be normalized as JSON.', error);
  }

  validateExactKeys(envelope, ENVELOPE_KEYS, 'archive');
  if (envelope.format !== ARCHIVE_FORMAT) fail('unsupported-format', 'This file is not a supported portable archive.');
  if (envelope.formatVersion !== ARCHIVE_FORMAT_VERSION) {
    fail('unsupported-format-version', `Unsupported archive format version: ${String(envelope.formatVersion)}.`);
  }
  validateAppId(envelope.appId);
  validatePositiveVersion(envelope.schemaVersion, 'schemaVersion');
  validateIsoUtc(envelope.exportedAt);
  if (!isPlainObject(envelope.metadata)) fail('invalid-envelope', 'metadata must be an object.');
  validateExactKeys(envelope.integrity, INTEGRITY_KEYS, 'integrity');
  if (envelope.integrity.algorithm !== 'SHA-256' || typeof envelope.integrity.digest !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.integrity.digest)) {
    fail('invalid-integrity', 'Integrity metadata must contain a SHA-256 hex digest.');
  }

  const expectedDigest = await sha256Hex(canonicalStringify(bodyOf(envelope)));
  if (expectedDigest !== envelope.integrity.digest) {
    fail('integrity-mismatch', 'Archive contents do not match the recorded SHA-256 digest.');
  }
  return envelope;
}

/** Serialize only an archive whose envelope and integrity digest validate. */
export async function stringifyArchive(input, { pretty = true, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const envelope = await normalizeAndVerify(input, maxBytes);
  const text = JSON.stringify(envelope, null, pretty ? 2 : undefined);
  if (utf8Length(text) > maxBytes) fail('archive-too-large', `Serialized archive exceeds the ${maxBytes}-byte limit.`);
  return `${text}\\n`;
}

/**
 * Parse and verify an archive. Optional migrations run one version at a time:
 * migrations[1] upgrades schema v1 to v2, migrations[2] upgrades v2 to v3, etc.
 */
export async function parseArchive(input, {
  expectedAppId,
  targetSchemaVersion,
  migrations = {},
  validateData,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  if (!isPlainObject(migrations)) {
    fail('invalid-options', 'migrations must be a plain object keyed by source schema version.');
  }
  if (validateData !== undefined && typeof validateData !== 'function') {
    fail('invalid-options', 'validateData must be a function.');
  }
  const envelope = await normalizeAndVerify(input, maxBytes);
  if (expectedAppId !== undefined) {
    validateAppId(expectedAppId);
    if (envelope.appId !== expectedAppId) fail('app-mismatch', `Expected archive for ${expectedAppId}, received ${envelope.appId}.`);
  }

  let data = cloneJson(envelope.data);
  const sourceSchemaVersion = envelope.schemaVersion;
  const destinationVersion = targetSchemaVersion ?? sourceSchemaVersion;
  validatePositiveVersion(destinationVersion, 'targetSchemaVersion');
  if (sourceSchemaVersion > destinationVersion) {
    fail('unsupported-schema-version', `Archive schema v${sourceSchemaVersion} is newer than supported schema v${destinationVersion}.`);
  }

  let version = sourceSchemaVersion;
  while (version < destinationVersion) {
    const migration = migrations?.[version];
    if (typeof migration !== 'function') {
      fail('missing-migration', `No migration is registered for schema v${version} to v${version + 1}.`);
    }
    let migrated;
    try {
      migrated = await migration(cloneJson(data));
      data = cloneJson(migrated);
    } catch (error) {
      if (error instanceof PortableArchiveError) throw error;
      fail('migration-failed', `Migration from schema v${version} to v${version + 1} failed.`, error);
    }
    version += 1;
  }

  if (validateData !== undefined) {
    try {
      const valid = await validateData(cloneJson(data));
      if (valid === false) fail('invalid-data', 'Archive payload failed application validation.');
    } catch (error) {
      if (error instanceof PortableArchiveError) throw error;
      fail('invalid-data', 'Archive payload failed application validation.', error);
    }
  }

  return {
    appId: envelope.appId,
    sourceSchemaVersion,
    schemaVersion: destinationVersion,
    exportedAt: envelope.exportedAt,
    metadata: cloneJson(envelope.metadata),
    data,
    integrity: { algorithm: envelope.integrity.algorithm, digest: envelope.integrity.digest },
    migrated: sourceSchemaVersion !== destinationVersion,
  };
}
