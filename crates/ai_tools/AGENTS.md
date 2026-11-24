# ai_tools

## What it is

Part of AI: assembles every domain crate's AI tool implementations into
the one `AsyncToolCollection` every AI surface (chat, agent sessions, MCP)
calls through, plus the cross-cutting tools (search, deferred
execution, display) that don't belong to a single domain.

## Start here

- `src/lib.rs`: the composition point — imports each domain crate's
  `inbound::toolset` module and builds the combined `AsyncToolCollection`
  and frontend schema set.
- `ReadAgentSession` is eager across chat, agent sessions, and MCP, and is also
  in the base toolset every host and memory research share; keep its
  registration covered by the host tests.
- `src/build_context.rs`: inject CRM rule discovery into both EmailPgRepo
  compositions so selected Team reads use the shared bounded core.
- `src/search.rs` / `src/search_tools.rs`: cross-entity search tools.
- `src/deferred.rs`: tools whose result arrives after the turn (long-running
  work).
- `src/tool_context.rs` + `src/tool_context/`: per-tool context extraction.
- `src/import_workspace.rs`: `ToolEntityCreator` as the import crate's
  `WorkspaceWriter` (folders, documents, tasks, databases as Macro AI for the
  user), sharing its document/task paths with `EntityCreator`; Notion bodies
  go through `DocumentCreator::create_notion_markdown`, including page-local
  typed database-card occurrence maps. Database creation uses caller-reserved ids
  and owner-only filing; saved-view creation safely reuses committed ids after a
  lost response. The folder privacy port checks concrete grants and ancestry,
  leaving the import domain to reuse its persistent personal mirror when needed.
  `share_with_team`
  shares a folder through `ProjectService::edit_project` (edit level) and a
  document through `DocumentService::set_team_share`. Notion pages and tasks
  are created with their page's dates (`NewDocumentMetadata::created_at` /
  `updated_at`), and folders through
  `ProjectService::create_project_dated_by_contents`, so the copy keeps
  Notion's dates. The workspace writer captures a Notion document's initial
  snapshot revision. The deferred rewrite requires a matching ledger receipt
  and owner access, then calls sync-service's internal link update with the
  inspected revision. Reviewed workspace imports carry a typed
  `ImportVisibility` through document, task, folder and tracker-project
  creation: personal items
  get an exact OFF override before insertion; shared items retain defaults.
  Personal tasks also omit teammate assignees, returning a typed notice for the
  import report; keep the same verdict on every property pass, including retries.
  Propagate roster lookup errors on assignee replay so a transient outage cannot
  clear an omission notice without applying the assignment.
  Notion tasks have no direct team grant; shared lists grant team access
  through their folder, while single tracked tasks (Linear) stay team-shared
  at creation.
  `ImportedTargetReader` reads document/folder/database/initiative lifecycle
  state through their owning domain ports, independently of viewer permissions;
  root-folder reuse separately checks view access. Transient read failures propagate
  so the import domain does not invalidate a live copy on an outage.
Return `SourceStopReason::RecordedTableMissing` only when the recorded table
is gone; keep storage and database-service failures retryable so reservation
never permanently downgrades page cards on an outage. Normalize database
validation, not-found, explicit resource permission and version-conflict errors
into `DatabaseWriteFailure`; repository/service outages stay run-wide. The
import domain owns source retry thresholds and link fallback decisions.
Map project/folder receipt and grant-read errors to `FolderUnavailable`, so the
next run rechecks the folder. Type folder creation/existence errors too, including
parent authorization and target liveness reads. Keep database access failures source-scoped.
Missing deterministic starter table/title IDs return typed errors without raw
ids or messages; never select another table or column by position.

- `src/import_workspace/lifecycle.rs`: physical lifecycle dispatch through owning
  ports. PostgreSQL adapter tests cover live targets without grants,
  trash/restore/purge and transient failures; hosts never reach service repos.
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
  domain owner (search, deferred, self-knowledge, display).
- `Subagent` was removed: it was a one-shot completion with no tools. Its
  schema survives only as `schemas::subagent`, so saved chats still render.
  `ReadActivity` was removed the same way (`macro.activity.mine()` covers it);
  its schema survives as `schemas::read_activity`.
- Not here: a domain's own tools — those live in that domain crate's
  `inbound::toolset` (e.g. `forms`, `agent_session`) and are
  only wired in here.

## Boundaries

- Depends on: nearly every domain crate with tools (`forms`,
  `agent_session`, `anthropic` (wire types for the legacy code-execution
  schemas), `web_search` (`WebSearch`,
  `WebFetch` via Tavily), `initiative`, `collab_surface`, `favorites`,
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

- `src/memory.rs` wires private memory tools and read-only research; `src/bin/memory.rs` runs awaited one-user generation.

## Checks

- `cargo test -p ai_tools` (`SQLX_OFFLINE` unset).
- Keep import access regressions on the real `ToolEntityCreator` → owning service
  → PostgreSQL creation path (`tool_context/test/import_link_access`); mock external
  markdown/sync endpoints rather than rebuilding permission resolution in tests.
- After adding/changing a tool: `cargo run -p ai_tools --bin gen_tool_schemas`
  and `--bin gen_ai_request_schemas` to refresh generated frontend schemas.
- `DisplayResults` decodes its view with `dynamic_ui` and returns it; readers render the result, never the arguments. Its schema comes from `dynamic_ui::View`.

## Related

- Rules: `.agents/rules/rust/architecture.md` · Skill: `create-ai-tool`

Reviewed Linear/Jira imports also register read-only tracker connections in every
host. `src/import_trackers.rs` creates stable-id tasks via ordinary markdown and
projects via `InitiativeServiceImpl::create_imported`, with Macro AI attribution;
project, parent and label writes pass through the owning property services.
