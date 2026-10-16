# ADR 0003: Defer a generic storage package; start Khidma Desk

- Status: accepted for the v0.1 prototype.
- Date: 2026-10-16

## Context

The browser acceptance suite now exercises Portable Archive through Record Vault. The initial store has one simple record shape. Khidma Desk has different domain entities (customers, service jobs, quotes, payment records), lifecycle rules and validation requirements.

## Decision

1. Do not create a standalone generic storage-adapter package yet. Current evidence only demonstrates one Storage-compatible driver; another abstraction would be speculative.
2. Keep Record Vault for record-shaped use cases where its model is a fit. Do not stuff customer/job/payment data into its generic title-and-notes fields.
3. Build a small first-party Khidma domain module with explicit customer/job/payment contracts and tests.
4. Reuse Portable Archive only for versioned export/import. Keep Khidma persistence domain-specific behind one narrow store module.
5. v0.1 is a local-first prototype: a single browser, localStorage, no account or cloud sync. All writes use a single versioned state key; imports are validated fully before replacement and must detect state changes during asynchronous verification.
6. Record payments as user-entered claims only. No payment is processed, confirmed, settled, or reconciled by the app. Estimated amounts and printable summaries are not represented as legally compliant invoices or quotations.

## Revisit the storage decision when

A second independently implemented persistence driver is required by a real use case (for example IndexedDB with larger local datasets, or a server-backed adapter), and we can define shared consistency, transaction, conflict, migration, and failure semantics from evidence.

## Acceptance gates

- Domain transitions and financial-record invariants have automated tests.
- Local persistence only advances in-memory state after the storage write succeeds.
- Archive import validates format, digest, application ID, schema and complete domain structure before one-key replacement.
- Invalid import, storage failure and observed concurrent modification preserve the existing state.
- Chromium end-to-end tests exercise the complete first workflow and mobile layout.
- User-facing copy makes local storage, privacy, backup and payment limitations explicit.
- Cross-browser validation, data-loss recovery, and local legal review remain required before any pilot with real customer data.
