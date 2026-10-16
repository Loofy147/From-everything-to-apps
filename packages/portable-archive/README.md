# Portable Archive

**Status:** `candidate` until remote CI passes and a consuming app independently validates its import boundary.

Dependency-free module for creating, serializing, and validating versioned JSON archives without a Puter/database/UI dependency.

## Runtime

- Node.js `>=22.12` for repository tests.
- Modern browsers with Web Crypto in a secure context.
- No runtime npm dependencies.

## API

```js
import { createArchive, stringifyArchive, parseArchive } from '@from-everything-to-apps/portable-archive';

const archive = await createArchive({
  appId: 'personal-workspace',
  schemaVersion: 1,
  data: { projects: [{ id: 'p1', title: 'Repair workshop', done: false }] },
  metadata: { locale: 'fr-DZ', purpose: 'backup' },
});
const json = await stringifyArchive(archive);
const restored = await parseArchive(json, {
  expectedAppId: 'personal-workspace',
  targetSchemaVersion: 1,
  validateData: (data) => Array.isArray(data.projects),
});
```

The example does not save a file or persist data. The consumer must supply file/download UI, storage, schema validation, and a safe restore transaction.

## Migrations and errors

`migrations[1]` upgrades schema v1 to v2; `migrations[2]` upgrades v2 to v3. Migrations are explicit and sequential. Read `PortableArchiveError.code` instead of parsing messages; useful codes include `invalid-json`, `archive-too-large`, `app-mismatch`, `unsupported-format-version`, `integrity-mismatch`, `missing-migration`, `migration-failed`, `invalid-data`, and `crypto-unavailable`.

## Limits

SHA-256 is not a digital signature or a keyed MAC and can be recomputed by an attacker. The archive is not encrypted. A valid archive is not proof its payload is valid for the target domain. This module does not implement storage, backup scheduling, atomic restore, database transactions, or crash recovery. The default size cap is 10 MiB (caller-configurable up to 100 MiB). JSON-only payloads cannot directly encode Date, Map, BigInt, undefined, non-finite numbers, class instances, cycles, or binary assets.

Tests: run `npm test` from the repository root.
