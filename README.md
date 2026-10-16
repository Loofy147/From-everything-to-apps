# From Everything to Apps

**Purpose:** turn useful ideas and small capabilities from the `Loofy147/everything` reference fork into independently engineered, reliable, portable applications.

The reference repository is an input for research—not an architecture we must preserve and not a reason to copy whole applications. We will extract small units of value, specify the behaviour we need, and then choose deliberately whether to reuse, adapt, reimplement, or reject each candidate.

## Engineering principles

- **Behaviour before code:** start from a user outcome, acceptance criteria, and failure cases.
- **Small, justified abstractions:** do not build a universal framework before multiple real use cases require one.
- **Durability by evidence:** test persistence, interrupted operations, export/import, backups, and recovery.
- **Portable by default:** keep domain logic independent of Puter or any single vendor; isolate external services behind explicit adapters.
- **Secure defaults:** validate untrusted input, enforce access boundaries, avoid secret exposure, and minimize collected data.
- **License and provenance hygiene:** record source revisions, preserve notices, review transitive dependencies and assets, and prefer clean-room reimplementation when that is simpler or safer.
- **Release discipline:** reproducible builds, automated tests, dependency pinning, security review, and honest release status.
- **Algeria-aware, not Algeria-limited:** where relevant, support Arabic RTL, French, DZD, mobile-first usage, accessible exports, and offline-tolerant workflows without hardcoding local assumptions into core logic.

## Current plan

1. Establish the engineering charter and reference-evaluation workflow.
2. Maintain a source/provenance register for candidate capabilities.
3. Build one small, dependency-free capability with tests and explicit contracts.
4. Prove it through failure-oriented tests before using it in an application.
5. Expand only when a real workflow demonstrates that the capability is reusable.

## Repository layout

- `docs/` — strategy, engineering standards, architecture decisions, candidate evaluations.
- `packages/` — small reusable capabilities with independent contracts and tests.
- `apps/` — focused applications built from proven capabilities.
- `tests/` — cross-package and end-to-end tests as the project grows.

## Reference

- Reference fork: https://github.com/Loofy147/everything
- Working repository: https://github.com/Loofy147/From-everything-to-apps

## Status

The repository is in foundation stage. No application or capability should be described as production-ready until its documented acceptance checks and release gates have passed.
