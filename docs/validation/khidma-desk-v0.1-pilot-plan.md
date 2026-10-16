# Khidma Desk v0.1 — Manual Validation and Pilot Checklist

**Status:** preparation protocol only. No sessions have been conducted by this document, and no product demand is established.

## 1. Purpose and boundaries

Use this plan to identify usability, accessibility, browser-compatibility, and backup-recovery problems before considering a pilot. Separate three questions in the notes:

1. Can a service provider complete the workflow without help?
2. Can the provider understand how local storage, estimates, and manual payment notes work?
3. Is there enough evidence to justify another test or a later commercial experiment?

A successful usability session is not evidence of market demand, production readiness, accounting compliance, or payment verification.

**Use synthetic records only.** Khidma Desk stores data in unencrypted browser `localStorage`. Do not enter real customer names, telephone numbers, addresses, notes, payment references, credentials, or other sensitive or irreplaceable data. Do not record or process an actual payment. Do not use the prototype for live business operations.

## 2. Preparation checklist

Before a session:

- [ ] Start the app from a fixed local URL (for example, `python3 -m http.server 4173` and `http://localhost:4173/apps/khidma-desk/`).
- [ ] Use a disposable browser profile or a browser origin that contains no personal or business records.
- [ ] Confirm the browser and operating-system versions; note viewport size and whether the device is desktop or mobile.
- [ ] Have a separate folder ready for the exported test archive; use a clearly labelled filename.
- [ ] Prepare a deliberately invalid or tampered archive for facilitator-led import rejection checks. Do not ask participants to edit JSON unless that is part of the task.
- [ ] Explain that this is an early local-only prototype, and obtain permission before taking notes or collecting any optional recording. Do not record by default.
- [ ] Confirm that all names, addresses, references, and amounts used in the session are fictional.

### Suggested opening script

“We’re testing this prototype, not you. The app saves data only in this browser and does not encrypt or sync it. Payment entries are notes that a user types in; the app does not process or verify a payment. Please use only the fictional information we provide. You can stop at any point. I will note task outcomes and usability issues, not your real customer or financial information.”

## 3. Core workflow test

Run 3–5 exploratory sessions with people who currently manage independent service, repair, installation, or maintenance work. This small set is for finding problems, not for statistically valid market conclusions. Avoid coaching unless the participant is blocked; record each hint given.

Use the fictional scenario below, or equivalent synthetic values:

- Customer: **Atelier El Bahja**
- Job: **Inspect ventilation unit**
- Description: **Check noise and filter; fictional test only**
- Estimate: **12,000 DZD**, added after the job is created
- Recorded test payment: **3,000 DZD**, entered manually and never sent to a payment service
- Revised estimate: **15,000 DZD** after the test payment

| Step | Ask the participant to… | Record |
|---|---|---|
| 1 | Add the fictional customer. | Success without help / hint / blocked; time; confusion |
| 2 | Create the job without an estimate. | Whether the customer link and optional estimate are understood |
| 3 | Add the 12,000 DZD estimate after job creation. | Discoverability, input errors, and confirmation |
| 4 | Move the job through a permitted status. | Whether the status change and available options make sense |
| 5 | Record the fictional 3,000 DZD payment note. | Whether the participant understands it is manual and unverified |
| 6 | Increase the estimate to 15,000 DZD. | Whether the revised estimate and calculated remainder are understood |
| 7 | Switch to Arabic and inspect the layout, then switch back to French. | Labels, directionality, mixed text/numbers, overflow, or clipping |
| 8 | Export a backup and locate the downloaded JSON file. | Whether export is discoverable and the file is found |
| 9 | Restore the downloaded file after the facilitator clears the app’s local storage. | Whether recovery succeeds exactly; any uncertainty or data mismatch |

Do not measure typing speed as the primary outcome. The aim is to discover whether the application model and recovery path are understandable.

## 4. Backup recovery test (disposable data only)

Perform at least once outside the automated Chromium run and record the exact browser/version:

- [ ] Create a synthetic customer, job, estimate, status, and payment note.
- [ ] Export the backup outside the browser origin and retain the downloaded file.
- [ ] Close or reload the app. Use the browser’s site-data/storage controls to clear the local storage for the test origin only. Do not clear data for another site or a real profile.
- [ ] Reopen the app and confirm the original records are absent before importing.
- [ ] Import the saved archive and compare every customer, job status, estimate, payment amount, method, and reference with the known synthetic state.
- [ ] Attempt a facilitator-provided invalid or tampered archive while valid test data is present; confirm rejection and confirm the valid data remains unchanged.
- [ ] Record any mismatch, ambiguous warning, unexpected overwrite, or recovery step that required undocumented knowledge.

A successful in-app “clear then restore” test alone is not the same as recovery after clearing browser storage. Keep those results separate.

## 5. Accessibility and browser matrix

Use disposable data in each browser. Record the browser name and exact version, OS/device, viewport, language, and outcome.

| Check | French LTR | Arabic RTL | Result / notes |
|---|---|---|---|
| Chrome or Chromium desktop smoke test | [ ] | [ ] | |
| Second browser (Firefox or Edge) | [ ] | [ ] | |
| Mobile-width layout at 390 CSS pixels; no horizontal overflow | [ ] | [ ] | |
| Keyboard-only: Tab/Shift+Tab reaches every control in a logical order | [ ] | [ ] | |
| Enter/Space activates buttons and selects where expected | [ ] | [ ] | |
| Dialog opens with meaningful focus; Escape/cancel closes it; focus returns appropriately | [ ] | [ ] | |
| Visible focus indicator and sufficient zoom/reflow at 200% | [ ] | [ ] | |
| Screen-reader check with an available screen reader (for example, TalkBack, NVDA, or VoiceOver) | [ ] | [ ] | |
| Arabic labels and RTL direction; mixed Latin names, IDs, phone numbers, DZD values, and references remain readable | [ ] | [ ] | |
| Form errors/status announcements are perceivable and associated with the relevant action | [ ] | [ ] | |

Do not mark an accessibility row passed merely because a page renders without horizontal overflow. Note untested items as **NOT TESTED**, not Pass.

## 6. Session notes and evidence

Use anonymous session identifiers (for example, P01–P05). Do not store participant names, actual customer details, payment records, or contact information in this repository.

For each task, capture only:

- Outcome: **UNASSISTED / HINT / BLOCKED / NOT TESTED**
- Approximate elapsed time, if useful
- Number and kind of errors or workarounds
- Participant’s own wording about confusing or useful behaviour, redacted to remove identifying information
- Facilitator intervention and observed impact
- Issue severity: **BLOCKER / HIGH / MEDIUM / LOW**
- Proposed change and the evidence needed to verify it

Ask at the end:

1. “What do you currently use for these tasks, and what is frustrating about it?”
2. “Which part, if any, would you actually use again? Why?”
3. “What would prevent you from relying on a tool like this?”
4. “Would you schedule a follow-up to test an improved version with fictional records?”

Interest or compliments alone do not validate demand. Record observable commitments and follow-up actions separately from opinions. Do not solicit real customer data or offer this prototype as safe for live work.

## 7. Decision rules

**HOLD immediately** if any participant data is exposed, a valid saved record is unexpectedly overwritten, an export cannot be restored, the app implies a payment was verified, or a critical action has no understandable recovery path.

**Fix and retest** if the same task blocks at least two participants, if participants need repeated hints for a core task, if the storage/backup warning is misunderstood, or if any high-severity keyboard/RTL issue is found.

**Continue exploratory testing** only after no unresolved data-loss blocker remains and core tasks can be repeated from a clean browser origin. Treat this as a usability gate, not a commercial gate.

A later commercial experiment requires additional evidence—such as users agreeing to a concrete next step and eventually making a real commitment—not just successful test sessions. Production/pilot use also requires separate security, privacy, operational, backup, accessibility, and applicable legal/accounting reviews.

## 8. Results summary

Complete this section only after actual sessions; do not pre-fill results.

- Sessions completed: ___
- Browsers/devices tested: ___
- Backup recovery verified outside automated CI: **YES / NO / NOT TESTED**
- Keyboard/screen-reader audit completed: **YES / NO / PARTIAL**
- Blockers (include issue links, not personal data): ___
- Repeated high-severity usability problems: ___
- Changes required before another test: ___
- Decision: **HOLD / FIX AND RETEST / CONTINUE EXPLORATORY TESTING**
- Evidence and date of decision: ___
