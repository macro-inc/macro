---
description: "Type design, idioms, errors and observability, performance, and tests."
paths:
  - "crates/**/*.rs"
  - "services/**/*.rs"
  - "tooling/**/*.rs"
globs: "crates/**/*.rs,services/**/*.rs,tooling/**/*.rs"
alwaysApply: false
---

# Rust code

Type design, idioms, errors and observability, performance, and tests.

- **CS-10** Newtype your identifiers and tokens — wrap raw `String`
  ids/tokens/model-ids in a validated newtype that checks shape at construction.
- **CS-11** A closed set of string values is an enum, not a `String` — impl
  `Display`/`FromStr` as needed.
- **CS-12** Optional means `Option<T>` — don't rely on sentinel values or
  convention to express absence.
- **CS-13** Model tri-state data (not-loaded / missing / present) as one flat
  enum, not nested `Option`s or ad-hoc flags.
- **CS-19** Give third-party errors their own variant — don't collapse e.g. a
  `jsonwebtoken` failure into a generic internal error.
- **CS-20** Depending on a rate-limited external provider requires a fallback
  (fallback model, retry story, or documented degradation).
- **CS-21** Wire usage metering on every invocation path — MCP-triggered tool
  calls count too, not just the primary path.
- **CS-22** When adding `#[tracing::instrument]`, include `err` on `Result`
  functions and omit it on other return types. Never set `level = "info"` on the
  attribute. Log errors as structured fields (`tracing::error!(error=?e,
  "msg")`); prefer `.inspect_err` over `if let Err(e)` for logging.
- **CS-40** Repeated literals become named consts.
- **CS-41** Don't use `#[allow(...)]` — use `#[expect(..., reason = "...")]` on
  the narrowest item it applies to; `allow` silently rots when the lint stops
  firing, `expect` warns.
- **CS-42** Don't re-state trait bounds already implied by a supertrait.
- **CS-43** Use the smallest type that makes invalid states unrepresentable: a
  counter that can't go negative is unsigned, one that can't plausibly pass 255
  is a `u8`.
- **CS-44** Large inline strings belong in files — use `include_str!`.
- **CS-45** CLI binaries use `clap`, not hand-rolled arg parsing.
- **CS-46** Use `rootcause` for error handling in new code — it's preferred over
  `anyhow` these days. In code that's still on anyhow, prefer `bail!` for early
  error returns.
- **CS-47** Keep latency-critical services thin: push bytes directly instead of
  round-tripping through presigned URLs or extra services; dispatch non-blocking
  background work with `wait_until`.
- **CS-48** Don't do per-message work on hot websocket paths — accumulate and
  flush on a timer/alarm.
- **CS-49** Tests live in a sibling `test.rs`, not inline `#[cfg(test)]` blocks
  in the implementation file. See the [Rust
  guide](../../../docs/development/rust.md#test-the-affected-packages).
- **CS-50** Update affected tests for db-crate changes. Refresh SQLx metadata
  when queries/schema change or required cache data is missing, not for
  unrelated Rust-only edits. Run affected tests with `SQLX_OFFLINE` unset. See
  the [database guide](../../../docs/development/database.md).
- **CS-54** New library crates (not service binaries) put
  `#![deny(missing_docs)]` in `lib.rs` and document all public items. Do not
  mark documentation code blocks `ignore` to skip doctests unless explicitly
  directed.
- **CS-55** AI spans follow the OpenTelemetry GenAI conventions (`gen_ai.*`, see
  `crates/genai_telemetry`). Agent sessions of every harness are traced in one
  place: the session actor projects each session's ACP frames onto
  `invoke_agent` / `execute_tool` spans
  (`crates/agent_session/src/domain/session/telemetry.rs`), so do not add GenAI
  spans to a harness runtime — `agent_inmem` runs its agent loop with
  `with_genai_telemetry(false)` for that reason. Outside sessions (chat in
  `document_cognition_service`), the agent loop and
  `ai_toolset::ToolSet::try_tool_call` emit and enrich the `invoke_agent` /
  `chat` / `execute_tool` spans; do not open tool spans in tools or toolsets,
  and never record prompts, tool arguments or tool results as span fields or
  logs — they are content, recorded on the spans under the
  `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` policy and a size budget.
- **CS-68** Don't mark types `#[non_exhaustive]` by default. Exhaustive matches
  are how a new variant reaches every place that must handle it; reserve the
  attribute for types published outside the workspace.
- **CS-69** Derive serde, schema, and other traits on the type itself. Don't
  keep parallel copies (a `wire.rs` mirror of domain types) just to carry
  derives; add a separate type only when the wire shape genuinely differs.
