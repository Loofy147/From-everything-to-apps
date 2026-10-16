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
| `apps/archive-lab` | Static browser consumer UI for record create/update/delete, export/import | Original integration harness; uses import maps to connect the two packages. | Chromium CI passes create/edit/reload/export/clear/restore/tamper rejection and 390px layout. Manual cross-browser and external recovery checks remain open. |
| `packages/khidma-core` | Customer/job schema, state validation, status transitions, whole-DZD estimates and manual payment invariants | Original implementation based on the Khidma v0.1 spec; no upstream code copied. | 12 domain tests pass in PR CI. |
| `apps/khidma-desk` | Local-first service workflow with French/Arabic UI, localStorage and Portable Archive | Original application implementation; no upstream source files copied. It reuses Portable Archive by public API and has its own domain schema. | Chromium CI passes customer/job creation, status transition, payment entry, reload, export/restore, tamper rejection and Arabic RTL at 390px. Cross-browser tests, browser-data-loss recovery, accessibility review and user validation remain open. |
| `tests/browser/e2e.mjs` | Shared headless Chromium acceptance for Archive Lab and Khidma Desk | First-party test harness using Node.js built-ins and a Chrome DevTools Protocol session; no test-runner dependency. | Executed by `npm run check` in GitHub Actions. |

All claims above are limited to recorded test and commit evidence; successful automated tests do not establish production readiness.


## Personal OS Apps and integration-catalog screen

- Local implementation: `apps/personal-os/index.html`, `main.js`, `styles.css`, and `registry.json`. These are first-party files; the integration rows are service metadata/links and do not bundle provider code.
- Architecture decision: `docs/decisions/0004-personal-os-shell-and-provider-boundaries.md`.
- License/feature shortlist: `docs/integrations/universal-capability-catalog.md`. It links upstream license pages reviewed on 2026-10-16 and distinguishes MIT/Apache/BSD/MPL/public-domain candidates from AGPL and source-available licenses.
- No upstream third-party application source has been copied into the Personal OS shell. Source links are discovery/evaluation references only; they are not a blanket approval to reuse an entire application or its dependencies.
- Evidence gate: shell navigation, search, shortcut save/reload/remove, URL validation, theme persistence and 390px overflow are covered by the new Chromium acceptance extension when the containing PR CI passes. OAuth, API calls, identity, cloud sync, multi-browser shortcuts and accessibility audit are outside this shell slice.

- Multi-app suite extension: `apps/personal-os/apps.js` provides first-party Notes, Work Board, Research Library, Files & Documents, and Media Workbench workflows. Their data uses `@from-everything-to-apps/portable-archive` for versioned SHA-256 archive export/import. This is not copied third-party code; the current media module tracks production briefs and external output links but does not generate content. Files are text/Markdown, not arbitrary binary uploads.
