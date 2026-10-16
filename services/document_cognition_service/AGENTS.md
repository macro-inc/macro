# document_cognition_service

## What it is

AI chat feature: deployable service (mounted at `/cognition` behind the
gateway) hosting completions, streaming, tool selection, structured
completion, citations, and chat/attachment management.

## Start here

- `src/api.rs`: route module list — `completions`, `stream`, `chats`,
  `tool_selection`, `structured_completion`, `citations`, `attachments`,
  `preview`, `context`, `id_mapping`, `decisions`.
- `src/api/stream/chat_message.rs`: HTTP-POST-based chat streaming — replaces
  the old WebSocket approach; delivery to clients goes through
  `connection_gateway`, not this service's own socket.
- `src/api/structured_completion.rs` and `src/api/tool_selection.rs`: the
  structured-output and tool-selection completion paths used by `crates/agent`
  and `crates/ai_tools`.
- `src/service/ai_stream_registry.rs`: tracks in-flight streams so a stop
  request (`stream/stop.rs`) can cancel the right one.
- `src/api/decisions.rs`: authenticated named classification; policy and
  admission live in `jev::domain::decisions`, not the HTTP handler.
- `src/service/structured_completion.rs`: bounded tool-free completions that
  retain metering when an HTTP caller disconnects.
- `README.md`: Doppler-based local setup (forking `document_cognition_service`
  project configs, `just init_local_db`, `just debug`).

## Scope

- Owns: the HTTP surface for AI chat completions/streaming/tool-selection and
  this service's own chat/attachment/context models.
- Not here: agent orchestration logic, tool implementations, or AI billing —
  `crates/agent`, `crates/ai_tools`, `crates/ai_toolset`, `crates/ai_billing`
  (this service composes them).

## Recipes

- Add or change a completion/stream endpoint: the relevant `crates/ai_*` or
  `crates/agent` logic → `src/api/<area>.rs` → `src/api.rs` (router) →
  `src/openapi.rs`.
- Add a config value: `src/config.rs` → Doppler project
  `document_cognition_service` → `document_cognition_service_doppler_config`.
- Debug a running stream: `just debug` (sets `RUST_LOG` for `document_cognition_service,ai,ai_tools,anthropic`),
  `just log <since>`.

## Checks

- `cargo test -p document_cognition_service` (`SQLX_OFFLINE` unset; needs
  MacroDB — `just run_dbs` from repo root).
- After query changes: `nix develop --command just prepare_db` from the repo root.
- Swagger validity: `npx @apidevtools/swagger-cli validate "http://localhost:8084/api-doc/openapi.json"`
  with the service running.

## Gotchas

- `/decisions` returns 503 when the existing optional `TYPESAFE_API_KEY` is
  unset. The endpoint does not provision its provider credential.

## Related

- Skills: `debug-service`, `live-debug` · Rules: `.agents/rules/rust/db.md`,
  `.agents/rules/observability.md`
