# Source and Provenance Register

A record here does not imply code was copied or the upstream app passed our tests.

## Pinned reference snapshot

- Repository: https://github.com/Loofy147/everything
- Branch observed: `main`
- Commit: `06802a1e3749202e4db94d39c9ef5ab1a97d0ef1`
- Snapshot review date: 2026-10-16
- Root license observed in the fork: MIT; third-party materials may have separate terms.
- Scope so far: static repository, app README/manifest, lockfile metadata, and selected source inspection. Not every app was built or runtime-tested.

## Candidate register

| Candidate | Immutable blob evidence | Valuable idea | Decision |
|---|---|---|---|
| Notes | `src/notes/README.md` `e2d6134a853d0743f1447cefa73d4a3d876ba114`; `src/notes/src/main.js` `5024045703d1acd333c4b2f9adf379d58c063aef`; `src/notes/package.json` `9e528b8e5f347eafd60a92640622e2a036d48fda` | JSON backup/import flow, local development backend, save-state UX | Behaviour reference only; no source file copied. Review export/import edge cases and restore guarantees before adoption. |
| Spreadsheet | `src/spreadsheet/README.md` `3b7024515674772fafa3ea3f13d7f7a211a173de`; `src/spreadsheet/package.json` `86065ed720b613bdc3afda93a0166156138e127c` | Local draft vs cloud-save boundary, interoperable file format | Behaviour reference only; no source file copied. XLSX compatibility and app license obligations still require app-specific review. |
| PDF | Prior static review of `src/pdf` | Local PDF operations and dependency notice tooling | Hold reuse until font/source obligations and a possible `@pdf-lib/fontkit` notice gap are reconciled. |
| Documents | Prior static review of `src/documents`, including `docs/canvas-engine.md` and `AGENTS.md` | Local document-editing workflow | Hold the canvas engine because source docs conflict about license selection/restrictions. |
| Video/creative apps | Prior static review of `src/*-studio` | Media processing and local/cloud boundaries | Assess capability by capability; do not import whole apps. |

Before reuse, re-fetch current license and notices, compare blob SHAs, inspect changes since this snapshot, and update this register. Blob SHAs identify reviewed Git objects, not a legal opinion.


## Downstream capability implementation

| Our path | Role | Upstream lineage | Current evidence |
|---|---|---|---|
| `packages/portable-archive` | Versioned JSON envelope, SHA-256 integrity, size bounds, migration hook | No upstream code copied. Behavior requirements informed by Notes archive/import documentation at the pinned snapshot above. | 15 focused tests; workspace import tested; remote CI success. Does not encrypt, authenticate, persist, or perform a full restore. |
| `packages/record-vault` | Domain-validated record store using a Storage-compatible adapter and Portable Archive | Original implementation. The Notes and Spreadsheet docs informed local-first and export/import boundary review; no upstream source files copied. | 15 focused tests on a deterministic in-memory Storage adapter. Browser localStorage, real quota failures, browser crash/recovery, and multi-tab editing are not verified. |
| `apps/archive-lab` | Static browser consumer UI for record create/update/delete, export/import | Original integration harness; uses import maps to connect the two packages. | Module syntax included in CI. Manual browser acceptance checklist remains open. |

All claims above are limited to tests and commit evidence. Do not imply browser-level tests passed until they have been executed and their results recorded.
