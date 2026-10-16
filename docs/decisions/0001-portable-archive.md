# ADR 0001: First capability — Portable Archive

- Status: accepted for initial implementation; `candidate` until remote CI passes and a consuming app verifies import behavior.
- Date: 2026-10-16

## Context

Future apps need export/import without depending on one cloud vendor. Upstream Notes documentation describes JSON backup/import paths, but copying its application storage code would bring unrelated UI and vendor assumptions. The first slice is a small archive contract, not a notes app or universal persistence framework.

## Decision

Build a dependency-free JavaScript module using Web Crypto and a versioned JSON envelope: format/version, app ID, domain schema version, UTC timestamp, metadata, payload, SHA-256 digest, bounded input, strict shape checks, explicit errors, optional sequential migrations, and an application validation hook.

Persistence, browser file UI, encryption, cloud storage, and app-specific schemas remain outside this package.

## Limits and security

The checksum is unkeyed: it detects content changes when compared with its stored value, but does not authenticate a sender; an attacker can recompute it. The module does not encrypt data or prove that a backup can be restored. Imported payload remains untrusted and must pass app validation and authorization before persistence. Default import cap is 10 MiB, configurable up to 100 MiB. Web Crypto is required, and browser use should be in a secure context.

## Alternatives rejected

- Copy the upstream Notes storage/export implementation: brings unrelated source and vendor assumptions.
- Add a serialization dependency: unnecessary for a small JSON-only contract.
- Build universal persistence first: premature; this package does not claim to persist data.

## Acceptance criteria

1. Versioned deterministic archive and round-trip recovery.
2. Rejection of malformed JSON, wrong app, unsupported format/version, missing/unknown fields, invalid timestamps, oversized inputs, unsafe/non-JSON values, and digest mismatch.
3. Explicit sequential migrations; missing migrations and future schemas fail closed.
4. App validation can run before the caller uses imported data.
5. Tests run on the declared Node runtime without runtime dependencies.
6. Documentation distinguishes integrity, authenticity, encryption, persistence, and recovery.

Integrate only when an actual application workflow and tests show the archive contract fits.
