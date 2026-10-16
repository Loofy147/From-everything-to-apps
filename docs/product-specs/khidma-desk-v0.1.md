# Khidma Desk v0.1 — Product and Acceptance Specification

## Status

Prototype specification. This is a product hypothesis to test with real service providers, not proof of demand and not a production release.

## Target user and job-to-be-done

A self-employed service provider or tiny repair/installation business needs to keep customer requests, scheduled work, estimates, and manually recorded payments together without managing several disconnected notes and spreadsheets.

## One demonstrable workflow

1. Record a customer (name, optional phone and address).
2. Create a service job linked to that customer, with a title, description, optional appointment and estimated amount in DZD.
3. Move the job through explicit allowed statuses.
4. Record a payment entry (amount, method, optional reference) as an operator-entered note; never imply the app processes or verifies the payment.
5. Export a portable backup, clear the test data, and restore it.
6. Attempt an invalid/corrupted backup and verify that current data remains unchanged.

## Domain model v1

- Customer: ID, name, optional phone/address/notes, creation/update timestamps.
- Job: ID, customer ID, title, description, status, optional appointment timestamp, optional estimated amount in whole DZD, zero or more payment entries, creation/update timestamps.
- Payment entry: ID, amount in whole DZD, manually selected method, optional reference, recorded-at timestamp.
- Currency values are non-negative safe integers in DZD for v0.1; no fractional DZD, tax computation, discounts or accounting ledger.
- Statuses: `requested`, `quoted`, `scheduled`, `in_progress`, `completed`, `cancelled`.
- Allowed forward transitions: requested → quoted/scheduled/in_progress/cancelled; quoted → scheduled/in_progress/cancelled; scheduled → in_progress/completed/cancelled; in_progress → completed/cancelled. Completed and cancelled are terminal in v0.1.
- Payment entries require an estimated amount and their cumulative total cannot exceed that estimate. This is a product rule for the prototype, not accounting advice.

## Local adaptation

- French and Arabic UI copy in v0.1, with correct LTR/RTL layout; English may be used in developer-oriented names and errors.
- Locale-aware DZD display, not locale-sensitive storage values.
- Use the user's browser locale for dates; store timestamps in UTC.
- Phone/address are optional and validated only for safe length, not country-specific numbering. Avoid requiring a specific wilaya or address format.
- The app works locally in one browser and exports JSON; no online payment, WhatsApp integration, cloud account, user management, legally compliant invoice generation, e-signature or marketplace in v0.1.

## Data and security constraints

- Customer data stays in localStorage until the user exports it; localStorage is not encrypted and may be cleared by the browser.
- Imported files are untrusted. Validate app identity, format/schema versions, digest, record counts, field types, foreign keys, status transitions where applicable, and payment totals before writing.
- Import is replace-all in v0.1 and must be confirmed when data exists.
- Do not send customer data to AI, third-party storage, analytics or a remote API.
- Payment entries are self-reported and cannot be treated as proof of payment.
- A backup is only as useful as the user's saved copy and their ability to restore it; document this explicitly.

## Acceptance criteria

- [ ] Customer and job forms reject invalid data with accessible errors.
- [ ] A job must reference an existing customer.
- [ ] Status changes follow the transition matrix; terminal jobs cannot be reopened.
- [ ] Estimated and paid amounts use non-negative whole-DZD integers; payment total cannot exceed the estimate.
- [ ] Creating/updating a customer or job persists only after localStorage confirms the write.
- [ ] Page reload restores records without loss or duplication.
- [ ] Valid archive restore round-trips all fields and payments.
- [ ] Corrupt, wrong-app, future-schema, oversize and domain-invalid imports are rejected without replacing stored data.
- [ ] A storage write error and detected concurrent import change do not advance memory.
- [ ] Browser e2e covers the happy path, export/restore, invalid archive, and mobile layout.
- [ ] Arabic RTL and French LTR views are keyboard accessible and usable at 390px.
- [ ] Manual testing with at least two browsers, local backup recovery and prospective-user workflow validation remain open before pilot.
