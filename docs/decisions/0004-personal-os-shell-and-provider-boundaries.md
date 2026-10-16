# ADR 0004: Personal OS shell and provider boundaries

- Status: accepted for the first Personal OS shell; cloud provider decision remains open.
- Date: 2026-10-16

## Context

The repository now contains two first-party consumer apps (Archive Lab and Khidma Desk) and three candidate shared modules. The owner wants one personal workspace that can launch these apps, discover useful services and open-source tools, and serve as a basis for testing integrations.

An OS-style shell should improve discovery without absorbing app-specific domain logic or exposing credentials. The connected ChatGPT workspace can access several external service tools, but those credentials are not automatically available to a public static website.

## Decision

1. Add a first-party, framework-free static Personal OS shell at apps/personal-os/. The repository root redirects to it so static hosting has one obvious entry point.
2. Use a versioned static registry (registry.json) for app launches, shared-module status and integration metadata. Registry entries are declarative; they do not execute plugins.
3. Store personal shortcut names/URLs and theme preference locally in this browser only. Validate shortcut schemes (HTTP/HTTPS), disallow embedded URL credentials, cap list size, and render user input as text. Never store API tokens in shortcuts.
4. Mark workspace connectors as “not connected to this app” unless a real in-app auth/API handshake and acceptance tests have succeeded.
5. Keep provider integrations behind future adapters. Do not import upstream app code merely because a service has an API or the repository has a permissive root license.
6. The proposed adapter families are IdentityProvider, RecordStore, FileStore, JobRunner/EventBus and IntegrationRegistry. These are design contracts, not yet shipped generic APIs. Add a shared package only after multiple real workflows justify a stable contract.
7. Keep the initial hosting layer static and independently replaceable. Do not provision or repurpose a database as part of this shell-only decision.
8. Evaluate a new, dedicated Supabase project for the first authenticated cloud-sync implementation because it provides PostgreSQL and bundled auth/storage/realtime capabilities. Keep PostgreSQL schema migrations and exports portable; Neon or self-hosted Appwrite remain alternatives. This is a candidate selection, not a provisioned service or a final commitment.
9. Evaluate Activepieces Community Edition as a separate workflow service if a real automation is needed. Keep n8n in the source-available category and verify permitted use terms before use. Keep AGPL platforms such as Puter and AppFlowy separate unless a later license decision covers their obligations.

## Consequences

- The shell is useful immediately as an app launcher and link catalogue, but its shortcuts do not sync across devices.
- No current app gains login, shared database, remote backup or direct third-party API access through this shell.
- The app remains usable without Vercel-specific APIs and can be served from any static HTTP host.
- The integration catalog separates repository-level licenses from hosted service access and records known enterprise/commercial exceptions. This is an initial screen; exact-version and transitive-license checks remain mandatory before code reuse.
- Any later cloud-sync PR must specify an identity/ownership model, RLS/access-control policy, schema migration plan, deletion/export semantics, credential handling, and recovery tests before provisioning or connecting data.
