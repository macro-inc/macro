---
description: "Boundaries between crates and layers, and how handlers and APIs are shaped."
paths:
  - "crates/**/*.rs"
  - "services/**/*.rs"
  - "tooling/**/*.rs"
globs: "crates/**/*.rs,services/**/*.rs,tooling/**/*.rs"
alwaysApply: false
---

# Rust architecture and API design

Boundaries between crates and layers in the Rust backend.

- **CS-23** Do not grow `macro_db_client` — new domain logic gets a new crate;
  the catch-all crates must shrink, not accumulate.
- **CS-25** `mod.rs` declares submodules; it doesn't host logic — prefer the
  `foo.rs` + `foo/` file-and-directory style for modules with logic. Enforced by
  ast-grep `rust-mod-rs-declarations-only`, error.
- **CS-27** Shared domain tables are only touched by their owning crate — e.g.
  `entity_access` mutations go through `entity_access`/`entity_access_db_utils`,
  never raw SQL elsewhere.
- **CS-30** Axum handlers take shared services via `State`, not `Extension`.
  Enforced by ast-grep `rust-no-axum-extension-param`, warning.
- **CS-31** Attach cross-cutting services to the owning domain service, not ad
  hoc at the router/handler layer — e.g. `EntityAccessManagementService` hangs
  off the email/document service itself, the way the documents crate does.
- **CS-51** Domain modules reference no infrastructure or transport: no AWS
  SDKs, redis, reqwest, opensearch, kafka, axum, or http types under
  `src/domain/**` — wrap clients in outbound adapters behind ports; response
  mapping lives in inbound. Enforced by ast-grep `rust-no-infra-in-domain`
  warning, `rust-no-transport-in-domain` error.
- **CS-52** Dependencies point inward: `src/domain/**` never imports
  `crate::inbound`/`crate::outbound`, and `src/outbound/**` never imports
  `crate::inbound` — define a port in domain and implement it in the adapter.
  Enforced by ast-grep `rust-domain-no-adapter-imports` warning,
  `rust-outbound-no-inbound-imports` error.
- **CS-53** Inbound adapters run no database queries — handlers, tools, and
  listeners call a domain service backed by an outbound repository, never sqlx
  directly. Enforced by ast-grep `rust-no-sqlx-in-inbound`, warning.
