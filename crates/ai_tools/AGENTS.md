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
- `ReadAgentSession` is eager across chat, agent sessions, and MCP, and is also
  available to subagents; keep its registration covered by the host tests.
- `src/subagent.rs`: dispatches `snippet_specs` to parallel subagents.
- `src/search.rs` / `src/search_tools.rs`: cross-entity search tools.
- `src/deferred.rs`: tools whose result arrives after the turn (long-running
  work).
- `src/tool_context.rs` + `src/tool_context/`: per-tool context extraction.
- `src/import_workspace.rs`: `ToolEntityCreator` as the import crate's
  `WorkspaceWriter` (folders, documents, tasks, databases as Macro AI for the
  user), sharing its document/task paths with `EntityCreator`; Notion bodies
  go through `DocumentCreator::create_notion_markdown`. `share_with_team`
  shares a folder through `ProjectService::edit_project` (edit level) and a
  document through `DocumentService::set_team_share`. Notion pages and tasks
  are created with their page's dates (`NewDocumentMetadata::created_at` /
  `updated_at`), and folders through
  `ProjectService::create_project_dated_by_contents`, so the copy keeps
  Notion's dates. Notion tasks are created unshared and reached through their
  shared folder, while single tracked tasks (Linear) stay team-shared at
  creation.
- `src/import_jobs.rs`: `ImportJobs`, the shutdown token and tracker every
  host passes to `build_tool_service_context_from_env` (or its own import
  service) and calls `hand_over` on at shutdown, so running Notion imports
  release their runs to another process. Those hosts build the import ledger
  with `build_import_repo`, which wires agent-session notifications so the
  session presenting an import's review hears when its plan is ready and
  when its write ends.
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
  `messages`, `routines`, `ai_billing`, `ai_usage`, `ai_toolset`, `agent`),
  plus `bot_id`, `attachment`, `static_file`.
- Used by: `document_storage_service`, `agent_harness_service` (session
  tools, cognition, and public MCP).

## Recipes

- Add a tool to an existing domain: implement it in that domain crate's
  `inbound::toolset` → it's picked up automatically via `src/lib.rs`'s
  existing import — no change needed here unless it's cross-domain.
- Add a cross-domain tool: new module in `src/` → register in
  `src/lib.rs`'s toolset assembly → regenerate schemas (see Checks).

Canvas tools come from the Documents subtoolset and inherit its worker client,
admission and usage recorder in every host. ApplyCanvasEdits uses the same
edit capability but calls no nested model and emits no additional model charge; no new context or env vars are needed.

## Tool contracts

- Session user-tool finishers authorize the final edited arguments after review; preserve the selected account through confirmation and never approve an earlier draft then execute a changed one.

- Executable toolsets exclude legacy chats in every host and code mode. Keep historical parsing compatibility only in `frontend_compat.rs`; never merge it into provider schemas.

## Checks

- `cargo test -p ai_tools` (`SQLX_OFFLINE` unset).
- After adding/changing a tool: `cargo run -p ai_tools --bin gen_tool_schemas`
  and `--bin gen_ai_request_schemas` to refresh generated frontend schemas.
- Regenerate DisplayResults entity-reference enums from `apps/web` with `bun run gen-dynamic-ui-schema` after canonical entity changes.

## Related

- Rules: `.agents/rules/rust/architecture.md` · Skill: `create-ai-tool`

Reviewed Linear/Jira imports also register read-only tracker connections in every
host. `src/import_trackers.rs` creates stable-id tasks via ordinary markdown and
projects via `InitiativeServiceImpl::create_imported`, with Macro AI attribution;
project, parent and label writes pass through the owning property services.
