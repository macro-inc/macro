# ai_tools

## What it is

Part of AI: assembles every domain crate's AI tool implementations into
the one `AsyncToolCollection` every AI surface (chat, agent sessions, MCP)
calls through, plus the cross-cutting tools (search, subagents, deferred
execution, display) that don't belong to a single domain.

## Start here

- `src/lib.rs`: the composition point — imports each domain crate's
  `inbound::toolset` module and builds the combined `AsyncToolCollection`
  and frontend schema set.
- `src/subagent.rs`: dispatches `snippet_specs` to parallel subagents.
- `src/search.rs` / `src/search_tools.rs`: cross-entity search tools.
- `src/deferred.rs`: tools whose result arrives after the turn (long-running
  work).
- `src/tool_context.rs` + `src/tool_context/`: per-tool context extraction.
- `src/bin/gen_tool_schemas.rs`, `src/bin/gen_ai_request_schemas.rs`:
  schema-generation binaries the frontend consumes.

## Scope

- Owns: assembling the toolset and the handful of tools with no single
  domain owner (search, subagent, deferred, self-knowledge, display).
- Not here: a domain's own tools — those live in that domain crate's
  `inbound::toolset` (e.g. `forms`, `activity`, `agent_session`) and are
  only wired in here.

## Boundaries

- Depends on: nearly every domain crate with tools (`forms`, `activity`,
  `agent_session`, `anthropic`, `initiative`, `collab_surface`, `favorites`,
  `routines`, `ai_billing`, `ai_usage`, `ai_toolset`, `agent`), plus
  `bot_id`, `attachment`, `static_file`.
- Used by: `document_storage_service`, `document_cognition_service`,
  `agent_harness_service`, `mcp_service`.

## Recipes

- Add a tool to an existing domain: implement it in that domain crate's
  `inbound::toolset` → it's picked up automatically via `src/lib.rs`'s
  existing import — no change needed here unless it's cross-domain.
- Add a cross-domain tool: new module in `src/` → register in
  `src/lib.rs`'s toolset assembly → regenerate schemas (see Checks).

## Checks

- `cargo test -p ai_tools` (`SQLX_OFFLINE` unset).
- After adding/changing a tool: `cargo run -p ai_tools --bin gen_tool_schemas`
  and `--bin gen_ai_request_schemas` to refresh generated frontend schemas.

## Related

- Rules: `.agents/rules/rust/architecture.md` · Skill: `create-ai-tool`
