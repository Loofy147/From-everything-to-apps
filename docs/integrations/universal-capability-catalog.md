# Universal Capability and Open-Source Integration Catalog

**Review date:** 2026-10-16. **Purpose:** shortlist reusable service/software options for a personal OS. This is a repository-level license screen, not legal advice or a full SBOM audit. Confirm the exact version/tag, root and nested license files, build assets, fonts, model weights, transitive dependencies and product/cloud edition terms before reusing or redistributing code.

## Recommended capability model

Do not select one vendor as the entire OS. Define stable interfaces and pick providers by capability:

| Capability | Preferred first test | Alternatives | Boundary to preserve |
|---|---|---|---|
| Source control / CI | GitHub | GitLab, Forgejo | Repo API and CI results behind an adapter |
| Static hosting | Vercel Git deployment | Cloudflare Pages, Netlify, self-hosted static server | Static assets do not hold secrets |
| Identity / sessions | Decide after requirements; evaluate Supabase Auth first | Appwrite Auth or another standards-based OIDC provider | Principal, session, roles and permissions separated; server checks every protected request |
| Relational data | PostgreSQL schema/migrations | Supabase Postgres, Neon Postgres, self-hosted PostgreSQL | SQL and migrations are source of truth; provider SDK isolated |
| Local/single-machine storage | Existing local-first modules; SQLite where relational access is needed | Browser storage for disposable tests | Explicit data-loss/backup boundary and portable exports |
| Object/file storage | Exported Portable Archive now | Supabase Storage, S3-compatible services, Appwrite Storage | One file-store interface, expiring access, quota and restore tests |
| Automation / queued work | Evaluate Activepieces Community Edition | Separate n8n instance where usage terms permit; custom jobs later | Idempotency keys, bounded retries, audit and revoke controls |
| AI orchestration | Optional Flowise for a specific visual workflow | Hosted APIs or local models behind an AI adapter | No secrets in frontend; document which data leaves the device |
| Internal/admin UIs | First-party shell for core workflows | Appsmith for a private operations console | Admin tools are not the domain system of record |
| Design workflow | Penpot or Figma as an external design tool | Canva for visual assets | Keep exported design tokens/assets portable |
| Knowledge workspace | Link/use AppFlowy or Notion as separate service | First-party Notes once validated | Export path; do not copy AGPL code into this MIT tree without a compliance decision |
| Full cloud desktop | Puter as a separate platform/reference | Nextcloud and other self-hosted suite candidates | Treat as a complete separate product with own runtime, license and threat model |

## Shortlist and licensing distinctions

The links below point to upstream repositories or license documents. The catalog deliberately distinguishes OSI-style open-source candidates from source-available licenses and hosted services.

| Project | Repository-level license / boundary | Useful idea | Recommendation |
|---|---|---|---|
| [Supabase](https://github.com/supabase/supabase) | Apache-2.0 at repository level; individual components may vary | PostgreSQL, auth, storage, realtime and migrations | Strong first cloud-sync candidate; use a new project dedicated to Personal OS Apps; enforce RLS and keep secret keys server-side |
| [Appwrite](https://github.com/appwrite/appwrite) | BSD-3-Clause | Self-hostable backend with auth, data, storage and functions | Compare against Supabase if self-hosting and an integrated service are priorities |
| [PocketBase](https://github.com/pocketbase/pocketbase/blob/master/LICENSE.md) | MIT | Small SQLite-backed auth/data/files service | Good lightweight personal experiment; verify current project maturity and migration commitments before important data |
| [SQLite](https://github.com/sqlite/sqlite/blob/master/LICENSE.md) | Public domain for core SQLite; some repo build scripts have separate terms | Embedded relational persistence | Strong single-machine data foundation |
| [Drizzle ORM](https://github.com/drizzle-team/drizzle-orm) | Apache-2.0 | Typed, SQL-first persistence layer | Add only when server-side SQL schema/code warrants an ORM |
| [Activepieces](https://github.com/activepieces/activepieces/blob/main/docs/about/license.mdx) | MIT Community Edition; enterprise/cloud features use commercial terms | Workflow automation and MCP integrations | Candidate for a separately operated automation service; recheck exact feature directories |
| [Flowise](https://github.com/FlowiseAI/Flowise/blob/main/LICENSE.md) | Apache-2.0 for general core paths; specified enterprise paths/files commercial | Visual LLM / agent workflow builder | Optional separate AI workflow service; exclude commercial paths and audit dependencies |
| [Appsmith](https://github.com/appsmithorg/appsmith) | Apache-2.0 repository-level | Database/API internal admin UIs | Optional admin UI rather than replacing first-party app logic |
| [Penpot](https://github.com/penpot/penpot) | MPL-2.0 | Open design/prototyping workspace | Good design-tool integration; preserve file notices and source obligations |
| [AppFlowy](https://github.com/AppFlowy-IO/AppFlowy) | AGPL-3.0 | Knowledge/workspace app | Use as a separate service or study high-level concepts; do not copy code into this repository without a deliberate AGPL compliance decision |
| [Puter](https://github.com/HeyPuter/puter) | AGPL-3.0 repository-level | Browser desktop/app platform | Evaluate as a separate platform, not a small library; self-hosting footprint and license differ from this project |
| [n8n](https://github.com/n8n-io/n8n/blob/master/LICENSE.md) | Sustainable Use License plus separate Enterprise-licensed paths; not OSI open source | Automation platform | Can be evaluated for permitted personal/internal use as a separate service; exclude from unrestricted open-source reuse |
| [NocoDB](https://github.com/nocodb/nocodb/blob/develop/LICENSE.md) | Sustainable Use License; not OSI open source | Table-style interface over databases | Optional separate personal service; do not classify as MIT/permissive code |
| [PostgreSQL](https://www.postgresql.org/about/licence/) | PostgreSQL License | Portable relational database | Preserve SQL schema portability and export capability regardless of managed provider |
| [Nextcloud](https://github.com/nextcloud/server) | AGPL-3.0-or-later in the main server code | Self-hosted files, sharing and collaboration | Evaluate as a standalone service; do not embed code into the permissive workspace without compliance review |

Hosted services such as GitHub, Vercel, Notion, Airtable, Figma, Canva and ElevenLabs are useful integrations, but their service availability is not permission to reuse their software. The deployed shell currently links out to their official services; it does not hold their credentials or call their APIs.

## Review flags

- **AGPL-3.0:** Puter, AppFlowy and Nextcloud should initially be evaluated as independent deployments or behavior references. Network use and distribution obligations require legal review before incorporating covered code.
- **Source-available ≠ open-source:** n8n and NocoDB's Sustainable Use License imposes use restrictions. Personal/internal use may fit stated terms, but that does not make their code suitable as a permissive dependency or a customer-facing automation platform.
- **Split / dual licensing:** Activepieces and Flowise identify commercial/enterprise boundaries. Review exact directories and features selected, not just the root README badge.
- **Public-domain engine with repository exceptions:** SQLite's core is public domain, but build scripts and packaging may carry separate terms.
- **Hosted-service costs and lock-in:** A permissive repository license does not mean the hosted service is free, nor that every surrounding provider API uses the same license.
- **Current status:** no third-party app code has been copied by this dashboard/catalog implementation. Existing source register and provenance rules continue to apply.

## Adoption protocol for every new connector

1. Define the exact user workflow, required scopes and data classification.
2. Open the upstream license at an immutable tag/commit and inspect nested/enterprise/asset notices.
3. Prototype through a replaceable adapter or link-out first; do not copy code merely to avoid API integration work.
4. Test missing credentials, expired session, provider outage, limits, rate errors, disconnect/revoke and duplicate operations.
5. Document exactly what leaves the browser, who can access it, retention/deletion behavior and export/exit procedure.
6. Merge only with test and provenance evidence; mark as connected only after a real auth handshake and least-privilege acceptance tests succeed.
