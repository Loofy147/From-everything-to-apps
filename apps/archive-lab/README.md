# Archive Lab

A dependency-free browser consumer for `@from-everything-to-apps/portable-archive` and `@from-everything-to-apps/record-vault`.

## Run locally

Requirements: a modern browser with Web Crypto and Python 3 (or another static HTTP server).

From the repository root:

```sh
python3 -m http.server 4173
```

Open <http://localhost:4173/apps/archive-lab/>.

Do not open `index.html` directly from `file://`; ES modules, import maps, and Web Crypto require an appropriate server/secure context. No npm build step is required for this static demo.

## Acceptance checklist

- [x] Chromium CI: create/edit/reload records, export an archive, clear records, restore the archive, and reject a tampered archive without overwrite.
- [x] Chromium CI: Khidma Desk customer/job/payment workflow, export/clear/restore, tampered archive rejection, Arabic RTL at 390px.
- [x] Unit tests: malformed JSON, wrong application, unsupported format/schema, size limits, domain validation and v1-to-v2 Record Vault migration.
- [ ] Manually test in at least two browsers.
- [x] Khidma Desk Chromium CI: download a backup outside the origin, clear all origin storage, reload, import the backup, and compare the complete serialized state.
- [ ] Repeat origin-data-loss recovery manually for Archive Lab / Record Vault using disposable data.
- [ ] Perform keyboard and screen-reader checks, especially for dialogs and Arabic RTL mixed-direction values.

The checked items are automated acceptance evidence from CI, not a claim of production readiness. Manual cross-browser, accessibility, and real restore-after-data-loss validation remain open.

## Data and threat model

- State is saved in one localStorage key in this browser origin.
- There is no cloud sync, account system, multi-user concurrency control, encryption, or access control.
- Another tab or device does not automatically coordinate edits; the import path detects a storage-key change during validation but general edit conflict resolution is not implemented.
- A valid SHA-256 digest detects changes relative to the included digest but is not authenticity: anyone can recompute it.
- Imported records are validated before a single-key write. This does not replace a real transactional database or tested backup/restore process.
- Do not enter sensitive, regulated, or irreplaceable information into this prototype.
