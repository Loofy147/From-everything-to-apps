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

## Manual acceptance checklist

- [ ] Create a record; refresh the page and confirm it remains.
- [ ] Edit a title/notes/status; refresh and confirm the changes remain.
- [ ] Export an archive; verify a JSON file is downloaded.
- [ ] Clear records; import the exported file and confirm the records return.
- [ ] Modify one field inside an exported file without updating the digest; confirm import is rejected and existing records remain.
- [ ] Try malformed JSON, an archive for another app, an oversized file, and a correctly checksummed but invalid record; confirm rejection without overwrite.
- [ ] Try a v1 `record-vault` archive using the automated fixture/test; confirm it migrates to schema v2.
- [ ] Test in at least two browsers and after clearing site data only on disposable test data.

The checklist is not marked complete by automated unit tests alone. Browser-level manual checks must be performed and recorded separately.

## Data and threat model

- State is saved in one localStorage key in this browser origin.
- There is no cloud sync, account system, multi-user concurrency control, encryption, or access control.
- Another tab or device does not automatically coordinate edits; the import path detects a storage-key change during validation but general edit conflict resolution is not implemented.
- A valid SHA-256 digest detects changes relative to the included digest but is not authenticity: anyone can recompute it.
- Imported records are validated before a single-key write. This does not replace a real transactional database or tested backup/restore process.
- Do not enter sensitive, regulated, or irreplaceable information into this prototype.
