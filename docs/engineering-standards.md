# Engineering Standards

Exceptions require an Architecture Decision Record describing the trade-off and when it must be revisited.

## Product and scope

- Start with a specific user, job, context, and observable outcome.
- Write acceptance criteria, non-goals, failure modes, and data sensitivity before implementation.
- Prefer one complete workflow over a broad but shallow feature list.
- Do not build generic infrastructure until multiple real use cases demonstrate shared requirements.

## Architecture

- Domain logic must not depend directly on a hosting vendor, UI framework, payment provider, or identity service.
- Place external services behind narrow adapters with documented contracts.
- Keep packages small, independently testable, and explicit about their public APIs and compatibility.
- Prefer web standards and platform APIs when they meet the need; dependencies require a written reason.
- A package is not reusable merely because it lives under `packages/`; stable contracts and multiple real use cases must justify reuse.

## Data durability and portability

- Define when a write is successful, what interruption does, and how retries or duplicate operations behave.
- Never treat UI state as persisted state until the storage operation succeeds.
- Validate data at import and service boundaries; set explicit size, depth, count, and time limits for untrusted input.
- Version persisted schemas and test migrations. Fail closed when a required migration is missing.
- Test export/import round trips and restore into a clean environment. A backup is not proven until restoration is exercised.
- Encryption, access control, integrity checks, and authenticity are separate requirements.

## Security and privacy

- Apply least privilege and check authorization server-side wherever a server exists.
- Treat imported files, external API responses, user-authored rich text, and AI output as untrusted.
- Minimize personal data and cloud transmission; document what leaves the device and why.
- Never place credentials, tokens, private user data, or deployment secrets in source or test fixtures.
- Use safe parsing, output encoding, limits, and explicit error states. Do not silently discard corrupt user data.

## Dependencies, licences, and provenance

- Default to no runtime dependency for small core utilities.
- Review transitive packages, bundled assets, fonts, models, and generated artifacts—not only top-level manifests.
- Reject proprietary, noncommercial, unlicensed, or unclear items unless a recorded decision approves them.
- Preserve notices and meet reciprocal/source obligations. License metadata is a lead, not legal proof.
- Record upstream repository, immutable commit, paths/blob IDs, license, changes, and attribution for every reused code or asset.
- Prefer original implementation from a written behavior specification when copying code is unnecessary. Do not claim a formal clean-room process if source code or source-specific expression was reused.

## Testing and release

Use deterministic unit tests for normal and edge cases, negative tests for invalid data/versions, regression tests for defects, and integration/security/accessibility tests where relevant. Required release gates:

1. Acceptance criteria pass; non-goals are documented.
2. Build and tests pass on the supported runtime.
3. Code provenance, licenses, dependencies, and assets are reviewed.
4. Errors, permissions, privacy, and recovery are tested.
5. Export/import and backup restoration work where data can be lost.
6. Known limitations, support expectations, and rollback path are documented.

Status labels: `research`, `prototype`, `candidate`, `verified-module`, `pilot`, `production`. Unit tests alone establish `verified-module` at most—not product readiness.

## Localization and accessibility

Keep locale-specific labels, formatting, legal rules, and document templates configurable. Where relevant, verify Arabic RTL, mixed Arabic/French/numeric content, keyboard navigation, screen-reader labels, mobile use, and text zoom. Store money in an explicit documented representation. Define offline behaviour and conflict resolution instead of assuming permanent connectivity.
