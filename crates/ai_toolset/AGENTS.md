# ai_toolset

## What it is

Part of AI: the framework underneath every AI tool in the product — the
`AsyncTool` trait, JSON schema generation via `schemars`, per-tool context
extraction, and toolset collection/dispatch that `ai_tools` assembles
domain crates' tools with.

Do not change this crate without reading `TOOL_DESIGN.md` first; it is
deliberately stable and widely depended on.

## Start here

- `src/lib.rs` doc comment: a worked multi-context toolset example — read
  it before defining a new tool.
- `src/tool.rs`: `AsyncTool`, `ToolAnnotated`, `ToolResult`.
- `src/toolset/traits.rs` + `src/toolset/types.rs`: `AsyncToolCollection`
  and how tools from different contexts combine.
- `src/schema/generate.rs` + `src/schema/frontend_typegen.rs`: schema
  generation for both the model-facing JSON schema and frontend TS types.
- `src/annotations.rs`: required MCP tool annotations (every tool must set
  these).
- `src/actor.rs`: session-only `acting_as` schema injection, required selection, and trusted owner/requester resolution; public tool inputs remain unchanged.
- `src/context.rs`: `RequestContext`/`ServiceContext` and the `FromRef`
  extraction pattern.
- `src/origin.rs`: `ToolCallOrigin` (host, `ToolMode`, turn purpose, public
  MCP caller), set on `RequestContext` and recorded on every `execute_tool`
  span by `try_tool_call`, even with GenAI telemetry off.

## Scope

- Owns: the tool trait, schema generation, and collection mechanics, plus
  the tool-search wire types (`tool_search.rs`: `SearchToolsResponse`,
  `LoadToolsResponse`) the agent loop reads loads back from.
- Not here: any actual tool implementation — those live in domain crates
  and are assembled in `ai_tools`.

## Boundaries

- Depends on: `schemars`, `axum` (for `FromRef`-based context extraction).
- Used by: nearly every domain crate that defines tools (`forms`,
  `activity`, `agent_session`, `anthropic`, `databases`, `mcp_toolset`,
  `crm`, `routines`, and many more) plus `ai_tools` itself and `agent`.

## Recipes

- Define a new tool: implement `AsyncTool` in the owning domain crate →
  add required annotations (`src/annotations.rs`) → wire it into that
  crate's `inbound::toolset` module → picked up by `ai_tools`.

## Checks

- `cargo test -p ai_toolset` (`SQLX_OFFLINE` unset).

## Gotchas

- A new host that dispatches tools sets `RequestContext::with_origin` (or
  `AgentLoop::with_tool_origin`); agent loops default the host to their agent
  name. Origin fields are labels, never content or personal data.
- Every tool must declare MCP annotations; a tool without them fails to
  compile/register (see `src/annotations.rs`).
- Keep tool input roots free of `oneOf`, `anyOf`, and `allOf`; put tagged variants
  under a named property so provider validation accepts them. Schema generation
  rejects root composition when toolsets are built, including in their tests.
- A recursive input type recurses through an optional or nullable field, or a
  list that may be empty. Gemini rejects a whole request whose tool schemas
  hold a `$ref` loop of required fields, so schema generation rejects one too
  (`schema/validate/ref_loop.rs`).
- Gemini also rejects, with a bare 400 INVALID_ARGUMENT, a tool schema nested
  more than `GEMINI_MAX_SCHEMA_DEPTH` (30) levels of non-empty JSON objects and
  arrays. Inlining makes a deep input type count in full; schema generation
  lifts optional unions out of their `anyOf` wrapper and rejects what is still
  too deep (`schema/validate/depth.rs`).

## Related

- Docs: `crates/ai_toolset/TOOL_DESIGN.md` · Skill: `create-ai-tool`
