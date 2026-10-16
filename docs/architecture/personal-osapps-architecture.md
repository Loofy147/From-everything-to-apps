# Personal OS Apps — Architecture and Implementation Plan

**Status:** architecture baseline for a personal, modular OS-style workspace. The current shell is a public static prototype; it has no account system, remote data store, or app-side service credentials.

## Product objective

Provide one personal launchpad for independently developed tools, reusable capabilities, and service integrations. The workspace should help test complete real-world workflows while keeping the underlying apps portable and independently deployable.

This is not an attempt to copy a full desktop/OS platform. The shell is a control surface; it should not own every domain or become a new mandatory runtime dependency.

## Current deliverable

- apps/personal-os/ — responsive shell with Overview, My Apps, Integrations, and System Map views.
- apps/personal-os/registry.json — versioned, static registry of internal apps, capability modules, and integration options.
- apps/personal-os/main.js — registry validation, search, filters, theming and local personal shortcuts.
- index.html — root entry that routes to the Personal OS shell.
- apps/archive-lab/ — record-vault and archive test harness.
- apps/khidma-desk/ — local-first service operations prototype.
- packages/portable-archive, packages/record-vault, packages/khidma-core — candidate first-party shared capabilities.

The shell is static HTML/CSS/JavaScript and can be deployed as a Git-connected static project. Its current user-defined shortcuts are saved in this browser's localStorage, are not encrypted or synced, and must not contain credentials or sensitive URL parameters.

## Layered architecture

1. **Personal shell.** App launch, search, navigation, feature status, capability catalog and external-service links. It stores only local shortcut metadata and a theme preference.
2. **Domain apps.** Each app owns its domain schema, validation, UX and acceptance tests. No app imports another app's internal code. The five internal modules share a validated persistence and archive boundary; Archive Lab and Khidma Desk remain independently maintained sub-apps launched from the same shell.
3. **Shared capability contracts.** Promote a module only after two real use cases establish a stable contract. Existing candidates: Portable Archive, Record Vault and Khidma Core.
4. **Adapters.** Providers implement narrow interfaces for identity, persistence, file/object storage, search, job execution, notifications and AI. Domain logic must not depend directly on a provider SDK.
5. **Infrastructure.** GitHub for source/CI, Vercel for static hosting and previews, a selected database/auth service, and optional separate automation/design/media tools.

## Proposed adapter contracts

These are design contracts, not implemented APIs yet.

### IdentityProvider

- getSession() -> Session | null
- signIn(options) -> Session
- signOut() -> void
- getPrincipal() -> Principal | null
- hasPermission(resource, action) -> boolean
- refreshSession() -> Session | null

Roles/permissions must be validated server-side. Do not treat UI visibility, local storage, or user-editable profile metadata as authorization.

### RecordStore

- list(query) -> Record[]
- get(id) -> Record | null
- create(record, idempotencyKey?) -> Record
- update(id, expectedVersion, patch) -> Record
- delete(id, expectedVersion) -> void
- export(scope) -> PortableArchive
- restore(archive, mode) -> RestoreResult

The adapter defines durability semantics, pagination, transaction/conflict behavior and errors. expectedVersion prevents blind stale writes when a server implementation exists.

### FileStore

- put(key, bytes, metadata) -> FileMetadata
- get(key) -> bytes
- list(prefix, cursor?) -> Page<FileMetadata>
- remove(key) -> void
- exportManifest(scope) -> PortableArchive

The contract must define quotas, file limits, content-type validation, signed URL duration and access policy.

### JobRunner / EventBus

- enqueue(jobType, payload, idempotencyKey) -> JobId
- getStatus(jobId) -> JobStatus
- cancel(jobId) -> boolean
- publish(event) -> EventId
- subscribe(eventType, handler) -> Unsubscribe

A job must be idempotent or explicitly reject duplicate operations. External side effects require an audit record and bounded retry strategy.

### IntegrationRegistry

Every connector records: identifier, owner/tenant scope, auth mechanism, granted scopes, supported operations, data sent, data received, secret location, rate limits, health state, version and disconnect/revoke path. Default grants are empty; connect one capability at a time.

## Backend and deployment decisions

| Layer | Current decision | Why / exit path |
|---|---|---|
| Static shell | Vercel Git integration, Hobby team | Low-operations deployment and per-branch previews. The root is static; no server secrets belong in the build. |
| Local-only tests | Browser storage + Portable Archive | No setup cost; suitable only for disposable personal tests, not multi-device sync or sensitive records. |
| Identity | Dedicated identity boundary, provider undecided | Avoid embedding roles/permissions in app-specific profiles; enforce server-side grants. |
| Cloud persistence | Evaluate a fresh, dedicated Supabase project first; keep Neon/PostgreSQL and self-hosted Appwrite as alternatives | Supabase bundles PostgreSQL with auth/storage/realtime capabilities. Use standard PostgreSQL migrations and portable exports; isolate the Supabase SDK in an adapter. Do not reuse unrelated existing projects. |
| File storage | Exported Portable Archive first; cloud object store later | Prove restore semantics before sync. Prefer standard object-store APIs and expiring URLs. |
| Automation | Optional separate Activepieces deployment first; n8n only for permitted personal/internal use after license review | Automation is not required for the first usable workflow. Do not embed it into the shell. |
| AI | No direct AI provider configured in this static shell | Add an authenticated backend adapter with quotas and data disclosure only after defining a specific job-to-be-done. Never put provider secrets in browser code. |
| Observability | GitHub Actions initially; consider privacy-minimizing error reporting later | Browser usage/records should not be sent to analytics by default. |

Supabase is a proposed first cloud-sync adapter, not yet provisioned for this project. A separately named project and schema should be created only for this OS; current unrelated/inactive projects must not be repurposed. Before schema work, define principal ownership, RLS, retention/deletion, archive restore and rollback tests. The publishable/anon key may be browser-visible only with correct RLS and grants; service-role/secret keys must remain in trusted backend configuration.

## Security and privacy invariants

- The static shell is public. It is not an authentication boundary and does not make an app private.
- No integration tokens, database passwords or provider API secrets are stored in this repo, registry or local shortcut store.
- Never send real customer/job/payment data to external connectors by default.
- OAuth state, callback validation, PKCE where applicable, scoped authorization, token rotation and disconnect/revoke paths are mandatory for any direct app-side OAuth integration.
- Service credentials are owned by a trusted backend or secret manager; never embedded in frontend assets or VITE_/NEXT_PUBLIC_ variables unless the provider documents them as intentionally public.
- All external/imported JSON is untrusted; validation limits apply before writing.
- App cards and integration status are metadata only. “Workspace tool” means available from the ChatGPT work session; it is not a browser-app connection.
- Local shortcuts use only HTTP/HTTPS and reject embedded username/password. User-supplied content is rendered as text, not HTML.
- No background sync occurs. A cloud adapter must address ownership, conflict detection, migration, backup and restore before being enabled.

## Deployment and acceptance gates

1. Review PR and ensure the repository's unit + Chromium acceptance CI passes.
2. Connect the repository to Vercel under the intended team; allow a preview deployment and verify the deployed root redirects to the shell.
3. Check /apps/personal-os/, /apps/archive-lab/ and /apps/khidma-desk/; test search, navigation, dark mode and custom shortcuts.
4. Recheck at 390px viewport with long/mixed text and verify no horizontal overflow. A width check alone is not an accessibility audit.
5. Keep the deployed app marked personal prototype until keyboard/screen-reader and second-browser recovery checks pass.
6. Select and provision a separate backend; implement migrations, RLS and integration tests; never treat static hosting as secure data storage.
7. Add an export/restore exercise and a rollback path before using important data.

## Non-goals for this first slice

The Files & Documents module stores text/Markdown only; the Media Workbench tracks briefs and production stages rather than generating media. No single sign-on, multi-user sync, cloud database, direct API OAuth, automation execution, online payments, encrypted vault, universal plugin runtime or AI agent execution is shipped by the shell. Each needs a separate threat model, permissions contract and acceptance tests.
