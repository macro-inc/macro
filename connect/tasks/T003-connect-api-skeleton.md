# T003: `connect_api` skeleton and `connect_platform`

Depends on T002 (`connect_registry`). Base this branch on the integration
branch after T002 merges.

## Goal

A runnable `connect_api` HTTP service that serves the catalog, built on a
small `connect_platform` crate that gives Connect its own config loading,
tracing, and HTTP layers, so no Connect crate depends on Macro's platform
crates.

## Context

- `connect/AGENTS.md` (Boundary): Connect copies what it needs from Macro.
- Macro's platform crates to mine, keeping only what this task needs:
  `crates/macro_config` (Doppler `APP_SECRETS_JSON` in ECS, env otherwise),
  `crates/macro_env_var` (typed env structs), `crates/macro_entrypoint`
  (tracing and OpenTelemetry setup), `crates/macro_tower_layers` (inbound
  `traceparent`, request spans).
- `.agents/rules/config-and-service-urls.md` and `.agents/rules/observability.md`
  apply to Connect too, with Connect's own crates in place of Macro's.
- `docs/guides/new-service.md` section 1 (the crate) only; deploy sections are
  a later task.
- `connect/docs/catalog.md` for the catalog fields.

## Do

1. `connect/crates/connect_platform`:
   - Config: a typed struct loaded once at startup from the process
     environment, or from `APP_SECRETS_JSON` when present (same precedence as
     `macro_config`). Missing required values fail startup with the variable's
     name. The one `std::env` read carries
     `#[expect(clippy::disallowed_methods, reason = "...")]`.
   - Telemetry: tracing subscriber plus OTLP export, configured by standard
     `OTEL_*` variables; a no-op exporter when no endpoint is set.
   - HTTP: a tower layer that adopts inbound W3C `traceparent` and opens a
     request span.
2. `connect/services/connect_api` (binary `connect_api`, workspace member):
   - axum router: `GET /health` and `GET /v1/catalog` returning every `live`
     app from `connect_registry` as JSON: `id`, `name`, `description`,
     `access`, `mcp_url`, `icon_url` (`/v1/catalog/<id>/icon.svg`), plus
     `GET /v1/catalog/{id}/icon.svg` serving the embedded icon.
   - OpenAPI with `utoipa` at `GET /openapi.json`.
   - Config: `PORT` (default 8080) via `connect_platform`.
3. Tests: router tests with `tower::ServiceExt::oneshot` for the catalog
   (only `live` apps, fields present), the icon route (content type, 404 for an
   unknown id), and config loading (env, `APP_SECRETS_JSON` precedence,
   missing value error).
4. `AGENTS.md` (from `.agents/templates/AGENTS.md`) plus `CLAUDE.md` symlink
   for both crates, including how to run `connect_api` locally.
5. Run `just hakari` after `Cargo.toml` edits.

## Done when

- `cargo nextest run --all-features -p connect_platform -p connect_api` passes.
- `cargo run -p connect_api` starts and `curl localhost:8080/v1/catalog`
  returns the catalog (paste the first app in the Result).
- `cargo clippy -p connect_platform -p connect_api --all-features --all-targets -- -D warnings` passes.
- `cargo x deps --check` and `just check` pass.

## Out of scope

Database, OAuth connect flow, MCP gateway, Docker image, Pulumi, Doppler
values, CI deploy workflows.

## Result

### Changed

- `connect/crates/connect_platform/`: typed startup configuration loading with
  `APP_SECRETS_JSON` precedence, optional OTLP tracing, inbound `traceparent`
  request spans, tests, and `AGENTS.md` / `CLAUDE.md` guidance.
- `connect/services/connect_api/`: `GET /health`, `GET /v1/catalog`, embedded SVG
  icons, `GET /openapi.json`, router tests, and `AGENTS.md` / `CLAUDE.md` guidance.
- `Cargo.toml`, `Cargo.lock`, `.github/workspace-dep-closures.json`: workspace
  members and generated dependency artifacts.

### Checks

- `just hakari`: passed; generated the dependency closure entries.
- `cargo nextest run --all-features -p connect_platform -p connect_api`: passed,
  7 tests, 0 failures.
- `cargo clippy -p connect_platform -p connect_api --all-features --all-targets -- -D warnings`:
  passed.
- `cargo x deps --check`: passed.
- `just check`: passed. Its file filters skip `connect/` Rust sources, so a
  direct `cargo fmt --all -- --check` and direct ast-grep scan of both new
  `src/` trees also passed.
- `cargo run -p connect_api`: built, but default port 8080 could not bind
  (`Address already in use`; another listener occupies it). `PORT=18080 cargo
  run -p connect_api` started, and `curl http://localhost:18080/v1/catalog`
  succeeded. Its first app was:

  ```json
  {
    "id": "airtable",
    "name": "Airtable",
    "description": "Read and update bases, tables, and records.",
    "access": ["mcp"],
    "mcp_url": "https://mcp.airtable.com/mcp",
    "icon_url": "/v1/catalog/airtable/icon.svg"
  }
  ```

- Tempo trace verification: not run; no local collector was configured.
- Commit: blocked. `git add` failed creating the worktree `index.lock` because
  `/home/eric/Code/macro/.git/worktrees/T003-connect-api-skeleton` is mounted
  read-only. The changes remain uncommitted in this worktree.

### Open question

Nine `live` registry apps have no embedded SVG. Should their required
`icon_url` remain a URL that returns 404, or should a future registry task
provide a placeholder or make the field optional? This implementation exposes
the specified URL and serves only embedded icons.
