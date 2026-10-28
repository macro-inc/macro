---
description: "Use the workspace's standard Rust crates and their house idioms instead of hand-rolling or adding alternatives."
paths:
  - "crates/**/*.rs"
  - "services/**/*.rs"
  - "tooling/**/*.rs"
  - "**/Cargo.toml"
globs: "crates/**/*.rs,services/**/*.rs,tooling/**/*.rs,**/Cargo.toml"
alwaysApply: false
---

# Rust libraries

Reach for these before writing a helper or adding a dependency. Infrastructure
crates (`macro_config`, `macro_entrypoint`, `macro_service_urls`, `kafka_util`,
`sqs_worker`, `macro_cors`, `macro_tower_layers`, `macro_auth`,
`macro_authorization`) are covered by the config and observability rules; use
them instead of their generic equivalents.

- **CS-56** Error types: `thiserror` enums for every public error (domain and
  adapters), with caller-meaningful variants plus `Internal(rootcause::Report)`.
  Ports expose `type Err: std::error::Error + Send + Sync + 'static`; services
  map adapter errors with `rootcause::Report::new(e).into_dynamic()`. Binaries
  return `Result<(), rootcause::Report>`. Never add `anyhow` to a crate that
  doesn't use it (CS-46). Model: `crates/user_api_key`.
- **CS-57** No `Box<dyn Error>`, `Result<_, String>`, or `.unwrap()` /
  `.expect()` outside tests and startup invariants; an `expect` states the
  invariant it relies on.
- **CS-58** Parse structured text with `nom` (and `logos` for tokenizing a real
  grammar, as `crates/database_sql` does), not hand-rolled `split_once` /
  `strip_prefix` / index scanners.
- **CS-59** Enum string forms (CS-11) use `strum` derives (`EnumString`,
  `Display`, `AsRefStr`, `IntoStaticStr`, `EnumIter`) with `serialize_all`
  matching serde's `rename_all`, imported from `strum`, not `strum_macros`.
  Serde: API DTOs are `camelCase`; new enums are internally tagged (`tag =
  "..."`); `untagged` only for backward-compatible input. HTTP schemas are
  `utoipa::ToSchema`; AI-tool schemas are `schemars::JsonSchema`.
- **CS-60** Async traits are native: `fn x(&self) -> impl Future<Output = ...> +
  Send`. Use `#[async_trait]` only when the trait must be object-safe (`Arc<dyn
  Port>`), and say so in a comment.
- **CS-61** Concurrency uses tokio: `mpsc` / `oneshot` / `watch` / `broadcast` /
  `Notify`. `std::sync::Mutex` when no `.await` happens under the guard,
  `tokio::sync::Mutex` only across awaits. Every spawned background loop takes a
  `CancellationToken` and is tracked by a `TaskTracker`.
- **CS-62** Outbound HTTP: build one `reqwest::Client` with a timeout in the
  adapter's constructor and keep it; take the base URL from
  `macro_service_urls`; call `macro_tower_layers::inject_trace_headers` on every
  request. Never `Client::new()` per call or `.unwrap()` the builder.
- **CS-63** Time is `chrono` (`DateTime<Utc>`); `time` only where a dependency's
  API requires it. New ids are `Uuid::now_v7()` or a newtype's `generate()`
  (CS-01, CS-10), never `new_v4`.
- **CS-64** Statics use `std::sync::LazyLock` / `OnceLock`; literal regexes use
  `lazy_regex::regex!`, others a `LazyLock<Regex>`. Never add `lazy_static` or
  `once_cell`, and never compile a regex per call.
- **CS-65** Domain-service tests use hand-written fakes implementing the port;
  `mockall` only for narrow interaction assertions. DB tests use
  `#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]`; HTTP doubles use
  `wiremock`; transcript and replay output uses `insta`.
- **CS-66** Never wait for a condition by polling: no `yield_now` or `sleep`
  loops. Signal with `oneshot`, `Notify`, `watch`, `Barrier`, or a channel, and
  use `#[tokio::test(start_paused = true)]` for time.
- **CS-67** Dependencies come from root `[workspace.dependencies]` as `x = {
  workspace = true }`; after any `Cargo.toml` change run `just hakari` and
  commit `crates/workspace-hack`. Check the workspace list before adding a
  crate, and don't add one that duplicates an existing choice.
