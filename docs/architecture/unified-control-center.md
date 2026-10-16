# Unified Operations Control Center

## Intent

Give one operator a single entry point for the work itself and the context needed to act on it. The Personal OS overview is the control center; the child views stay focused domain workbenches. Global search, task links, a dashboard and consistent record validation connect the views without forcing every domain into a monolithic UI.

## Current surface

- **Work Board:** projects, tasks, priorities, due dates and status.
- **Observations & decisions:** findings, decisions, risks, incidents, ideas and follow-ups with severity, state, tags, evidence URL and an optional related task.
- **Keys, tokens & credentials:** an inventory of credential references with provider, environment-style secret name, purpose, declared scopes, chosen provider-side storage location, rotation/review date, inventory state and an optional related task.
- **Integrations:** a catalog of workspace tools and external building blocks. Catalog presence is not proof of connection.
- **Knowledge and delivery:** notes, research, text/Markdown documents, media briefs, the app launchpad, and backup/recovery.
- **Cross-cutting access:** global search, dashboard counters, quick-create actions and task links from observation/credential records.

The current browser data schema is version 2. Valid version-1 records are migrated in memory to version 2 by adding empty `observations` and `vaultEntries` collections while preserving the original six collections. The portable archive envelope version stays separate from the app's inner data schema version.

## Credential boundary: inventory is not secret storage

The credential view deliberately has no input for a key/token value. It persists only an inventory record:

- a human label and provider
- an environment-style variable name, such as `GITHUB_RELEASE_TOKEN`
- purpose and declared permissions/scopes
- a reference to where the value should be managed
- an optional review/rotation date, state, and related task

The metadata is saved in browser `localStorage` and included in normal Personal OS backups. Neither localStorage nor an ordinary JSON archive is encrypted. Keep metadata non-sensitive; do not record values, recovery codes, session cookies, private signed URLs, or other secrets in any field. The schema rejects unexpected keys rather than allowing an accidental `value`, `token`, or `secretValue` property to pass.

The current inventory status is operator-maintained metadata. Selecting “Recorded in provider” does not verify the provider, test a credential, or connect this frontend to an integration. Marking a credential “Revoked at provider” is also an assertion that the operator must first carry out at the provider; deleting an inventory row does not revoke anything.

## Required production design before handling actual credentials

1. **Identity and access control.** Add authenticated owner-scoped sessions and explicit roles. A browser's possession of localStorage must never be treated as identity or authorization.
2. **Provider-owned secret storage.** Store values in a proper backend-only secrets service or provider facility (for example, AppDeploy backend secrets, GitHub Actions secrets, Vercel environment variables or Supabase secrets). A frontend-only static site is not a secret boundary.
3. **Write-only submission.** Collect secret values through an out-of-band, short-lived, single-use submission flow or provider OAuth; never return existing secret values to clients and never put them in logs, analytics, crash reports, prompts, source files or exports.
4. **Least privilege and lifecycle.** Record intended scopes, distinguish metadata states from verified connection states, support rotation and revocation at the provider, and show evidence and timestamps for health checks.
5. **Audit trail.** Add a server-side append-only event history for create/update/rotation/revoke/permission changes, recording actor, time, result and credential reference without the secret value.
6. **Shared record persistence.** Move owner-scoped observations, task links and metadata into a real database with migrations and tested backup/restore. Preserve referential integrity and make destructive operations explicit.
7. **Integration adapters.** Connect one service at a time through replaceable adapters. Only claim “connected” when an authenticated handshake or equivalent provider-side validation succeeds. Workspace connectors, deployed-app credentials and user-authorized OAuth grants are distinct access channels.
8. **Operational controls.** Add rotation reminders, failed-connection observations, access review, scoped task generation, rate limits, request validation, a documented incident/recovery path, and manual browser/accessibility tests.

## Current limitations

- Frontend-only, browser-local storage; no user identity, team access, cloud sync or server-side audit log.
- No actual secret value is stored or managed by this UI.
- Integration catalog is informational; no real OAuth handshake, secret test, revocation, webhook or provider status probe is implemented.
- Rotation status is currently a date/status tracker, not an automated guarantee that a value was rotated.
- SHA-256 backup validation is an integrity check, not encryption, authorization or proof of authorship.
- UI and automated browser coverage do not prove production readiness or cross-browser/accessibility conformance.

## Acceptance criteria for this prototype

- Existing version-1 workspace data remains after schema migration.
- Observations and credential metadata can be created, edited, searched, exported and restored.
- Both record types can link to an existing task; a linked task cannot be deleted until its references are removed.
- A validated backup with invalid task references is rejected without modifying current data.
- Credential records cannot have additional secret-value fields and this UI never collects the actual value.
- Search opens the matching record and browser back/forward continues to work across views.
- Dashboard rotation counts reflect manually flagged records or dates that have passed.
- The small-screen layout has no horizontal overflow at a 390px viewport.
