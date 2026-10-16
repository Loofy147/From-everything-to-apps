# From Everything to Apps

**Purpose:** turn useful ideas and small capabilities from the [reference fork](https://github.com/Loofy147/everything) into independently engineered, reliable, portable applications.

The reference repository is research material—not an architecture we must preserve or a reason to copy whole applications. We extract small units of value, specify the behaviour we need, then choose deliberately whether to reuse, adapt, reimplement, or reject each candidate.

## Current state

| Area | Status | Evidence / next gate |
|---|---|---|
| Project charter and standards | Established | `docs/engineering-standards.md` |
| Extraction and provenance process | Established | `docs/capability-extraction.md`, `docs/source-register.md` |
| Portable Archive | Candidate | 15 focused tests pass; exported and restored through two consumers. SHA-256 is integrity-only, not authentication or encryption. |
| Record Vault | Candidate | 15 focused tests pass; Chromium tests exercise local persistence, reload, export/import, tamper rejection and 390px layout. Cross-browser and data-loss recovery for Record Vault remain open. |
| Khidma Core | Candidate | 12 domain tests cover customers, job references, status transitions, DZD limits and manual payment totals. |
| Archive Lab | Prototype | Chromium acceptance passes create/edit/reload/export/clear/restore/tamper rejection; used to verify portable data boundaries. |
| Khidma Desk | Prototype | Chromium covers invalid archive classes, storage-write failure, concurrent import conflict, and external-backup recovery after clearing application localStorage. User research, accessibility and cross-browser checks remain open. |
| Personal OS Apps | Prototype | One shell now contains Notes & Knowledge, Work Board, Research Library, Files & Documents, Media Workbench, plus Archive Lab and Khidma Desk. Six internal data collections share one local schema and verified Portable Archive backup/restore. Direct API connections, identity/cloud sync, accessibility and cross-browser review remain open. |

## Engineering principles

- **Behaviour before code:** start from a user outcome, acceptance criteria, and failure cases.
- **Small, justified abstractions:** do not build a universal framework before real use cases require one.
- **Durability by evidence:** test persistence, interrupted operations, export/import, backups, and recovery.
- **Portable by default:** keep domain logic independent of Puter or a single vendor; isolate external services behind adapters.
- **Secure defaults:** validate untrusted input, enforce access boundaries, avoid secret exposure, and minimize collected data.
- **License and provenance hygiene:** record source revisions, preserve notices, review transitive packages and assets.
- **Release discipline:** reproducible builds, automated tests, dependency review, and honest status labels.
- **Algeria-aware, not Algeria-limited:** where relevant, support Arabic RTL, French, DZD, mobile-first use, accessible exports, and offline-tolerant workflows without hardcoding local assumptions into core logic.

## First capability: Portable Archive

A dependency-free JavaScript package for a versioned JSON export/import envelope. It provides canonical SHA-256 integrity checks, bounded input, strict envelope validation, explicit errors, optional schema migrations, and an application validation hook. It does **not** implement persistence, encryption, authentication, or application-specific validation.

A checksum is not a digital signature and cannot prove who created an archive. Applications must treat imported content as untrusted and validate it before changing persistent data.

## Development

Requires Node.js `>=22.12`.

```sh
npm ci
npm test
```

Run focused checks with `npm run test:portable-archive` or `npm run test:khidma-core`. `npm run check` runs all unit tests, syntax checks, and a headless Chromium acceptance suite for Archive Lab and Khidma Desk. Core modules have no external runtime dependencies; domain packages import only local workspace code.

## Try the consumer harness

From the repository root, start a static server with `python3 -m http.server 4173` and open `http://localhost:4173/`. One Personal OS shell holds Notes & Knowledge, Work Board, Research Library, Files & Documents, Media Workbench and links to Archive Lab and Khidma Desk. Notes, tasks, projects, research sources, text/Markdown documents and creative briefs share a versioned local data store; Backup & Data uses the Portable Archive package to validate SHA-256 integrity and every record before restore. Shortcuts and theme preferences remain separate browser-local preferences and are not included in that data archive. Nothing is encrypted or synced, and the app does not yet authenticate or call external service APIs. Do not store sensitive or irreplaceable data. Automated Chromium acceptance does not establish production readiness; manual cross-browser, accessibility and user testing remain open.

## Layout

- `docs/` — standards, extraction protocol, provenance register, architecture decisions, and validation plans.
- `packages/` — small reusable capabilities with explicit contracts and tests.
- `apps/` — focused applications, added only when validated workflows justify them.
- `apps/personal-os/` — shell, static registry and custom shortcut launcher; architecture and integration shortlist are in `docs/architecture/` and `docs/integrations/`.
- `.github/workflows/ci.yml` — tests on pushes and pull requests.

## Source provenance

The source register pins the reviewed `Loofy147/everything` snapshot at commit `06802a1e3749202e4db94d39c9ef5ab1a97d0ef1`. Static review does not prove every upstream app builds or is production-ready. No upstream application source has been copied into Portable Archive; its requirements were informed by backup/import use cases in upstream documentation and our durability standards.

## Licensing

Original project code is MIT-licensed. Third-party code, dependencies, fonts, models, and assets retain their own terms; the root license does not override them. Update the source register and preserve required notices before reusing upstream code or assets.

## Status vocabulary

`research` → `prototype` → `candidate` → `verified-module` → `pilot` → `production`.

Unit tests alone do not make an application production-ready. Each status change requires the relevant gates in `docs/engineering-standards.md`.
