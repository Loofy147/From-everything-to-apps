# ADR 0002: Record Vault as the first Portable Archive consumer

- Status: accepted as a candidate harness; browser checks and a persistence-recovery review remain open.
- Date: 2026-10-16

## Context

Portable Archive needs a real consumer to demonstrate that validation is applied before data changes, not just that JSON can round-trip in isolation.

## Decision

Implement a minimal local-first Record Vault with real work-item records, a Web Storage-compatible interface, a browser localStorage adapter, JSON archive export/import, strict domain validation, and a v1-to-v2 schema migration. Provide a static browser demonstration in `apps/archive-lab`.

The store writes a new complete state to one storage key before advancing its in-memory state. Import validates format, digest, app ID, migration chain, and all records before attempting that write. It rejects if the observed local state changes during asynchronous validation or the backing storage differs from the snapshot. General cross-tab merge/locking is out of scope.

## Alternatives

- Import the entire upstream Notes app: rejected because it would introduce unrelated UI, storage design, and Puter dependencies.
- Use only an in-memory store: rejected because it would not exercise reload behavior.
- Claim durable backups from an archive checksum: rejected; a checksum does not prove successful persistence, authenticity, or restore.

## Guarantees and non-guarantees

- Existing in-memory state is not advanced if the storage write throws.
- Invalid, incompatible, corrupted, or domain-invalid imports are rejected before the storage write.
- A changed record set is stored in one key operation; this is not a database transaction across keys.
- localStorage is unencrypted and may be cleared by the user or browser.
- Multi-tab editing conflicts are detected for import but not generally merged or resolved.
- The demo's browser behaviour has not been manually verified until its acceptance checklist is completed.
- Unit tests exercise a deterministic Storage-compatible test adapter, not real browser quota, crash, eviction, or cross-browser behaviour.

## Acceptance gates

1. Create/update/delete and reload tests pass.
2. Valid export/import round trip passes.
3. Digest mismatch, invalid domain data, wrong app, future schema, missing migration, failed storage write, and concurrent-update tests preserve current data.
4. Browser module syntax check and repository CI pass.
5. Manual browser checklist completed before describing the demo as browser-verified.
6. Before real use, decide retention, backup location, encryption/access controls, restore procedure, and privacy requirements for the target data.
