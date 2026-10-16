# Khidma Desk

A local-first prototype for independent service providers to record customers, service jobs, estimates, scheduled work and manually entered payment records. User-facing copy supports French and Arabic (RTL).

## Run locally

Requires a modern browser with Web Crypto and Python 3 (or any static HTTP server). From the repository root:

```sh
python3 -m http.server 4173
```

Open <http://localhost:4173/apps/khidma-desk/>.

Do not open the file directly via `file://`. The browser needs the module/import-map URLs and Web Crypto in a suitable context. The app has no cloud service or runtime package dependency beyond the local workspace modules.

## v0.1 workflow

1. Add a customer (name required; phone and address optional).
2. Create a job linked to that customer. Store an optional appointment and estimated amount in whole DZD; an estimate can also be added or increased later.
3. Move a job through permitted status transitions.
4. Record one or more manually entered payment notes (method, amount and optional reference).
5. Export a JSON archive, clear disposable test data, and restore it.
6. Try a tampered archive; the app should reject it without replacing existing records.

## Data, limitations and safety

- Records are stored in one key in this browser's unencrypted `localStorage`. No data is sent to a server.
- Clearing browser/site data can erase records. Keep backup files in a separate safe place and periodically test restoration.
- Archive SHA-256 checks detect content mismatch with the included digest; they do not authenticate a sender. Anyone can recompute the digest.
- Import is replace-all after confirmation. Files are treated as untrusted; format, app identity, integrity and domain invariants are checked before the one-key write.
- The app detects storage changes observed during an import but does not provide general multi-tab merging, locking, or conflict resolution.
- Estimates can be increased after recorded payments, but cannot be removed or lowered below the cumulative recorded amount. This keeps the prototype’s own payment-total rule consistent when work scope changes.
- Payment entries are user-reported notes. The app does not process, receive, settle or verify payments.
- Estimated amounts are not official invoices or quotes, and the app does not calculate tax, comply with accounting requirements or issue regulated documents.
- This prototype has no multi-user access control, encryption, remote backup, audit-proof history, or tested recovery after browser data loss. Do not use it for sensitive or irreplaceable records.

## Tests

- Domain rules: `npm run test:khidma-core`
- Full checks: `npm run check` (unit tests, syntax checks and Chromium browser acceptance suite)

The browser suite runs on the GitHub Actions runner. Before a pilot, complete manual checks in at least two browsers, verify export files and restore from an external backup, and test the workflow with prospective service providers. This is a product hypothesis, not evidence of demand or production readiness.
