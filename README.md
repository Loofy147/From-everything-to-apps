# From Everything to Apps

**Purpose:** turn useful ideas and small capabilities from the [reference fork](https://github.com/Loofy147/everything) into independently engineered, reliable, portable applications.

The reference repository is research material—not an architecture we must preserve or a reason to copy whole applications. We extract small units of value, specify the behaviour we need, then choose deliberately whether to reuse, adapt, reimplement, or reject each candidate.

## Current state

| Area | Status | Evidence / next gate |
|---|---|---|
| Project charter and standards | Established | `docs/engineering-standards.md` |
| Extraction and provenance process | Established | `docs/capability-extraction.md`, `docs/source-register.md` |
| Portable Archive package | Candidate; core tests green | 15 archive tests pass; now exercised by Record Vault; browser execution and real restore workflow remain pending |
| Record Vault | Candidate; local record workflow implemented | 15 focused tests cover persistence boundary, import rejection, migrations and conflicts; actual browser storage and recovery behaviour still need manual checks |
| Archive Lab | Prototype | Static browser harness is committed; manual browser acceptance checklist remains open |

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

Run Portable Archive tests alone with `npm run test:portable-archive`. `npm run check` also syntax-checks package modules and the browser entry point. The core packages have no external runtime dependencies; Record Vault depends only on the local Portable Archive workspace package.

## Try the consumer harness

From the repository root, start a static server with `python3 -m http.server 4173` and open `http://localhost:4173/apps/archive-lab/`. Follow `apps/archive-lab/README.md`. This is a local-only prototype using browser `localStorage`; it is not encrypted or production-ready. The manual browser checklist has not yet been marked complete.

## Layout

- `docs/` — standards, extraction protocol, provenance register, and architecture decisions.
- `packages/` — small reusable capabilities with explicit contracts and tests.
- `apps/` — focused applications, added only when validated workflows justify them.
- `.github/workflows/ci.yml` — tests on pushes and pull requests.

## Source provenance

The source register pins the reviewed `Loofy147/everything` snapshot at commit `06802a1e3749202e4db94d39c9ef5ab1a97d0ef1`. Static review does not prove every upstream app builds or is production-ready. No upstream application source has been copied into Portable Archive; its requirements were informed by backup/import use cases in upstream documentation and our durability standards.

## Licensing

Original project code is MIT-licensed. Third-party code, dependencies, fonts, models, and assets retain their own terms; the root license does not override them. Update the source register and preserve required notices before reusing upstream code or assets.

## Status vocabulary

`research` → `prototype` → `candidate` → `verified-module` → `pilot` → `production`.

Unit tests alone do not make an application production-ready. Each status change requires the relevant gates in `docs/engineering-standards.md`.
