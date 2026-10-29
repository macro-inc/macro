# import

## What it is

Belongs to AI chat and Settings: the import pipeline tracking external items
(Linear and Jira issues, Notion pages, Slack channels) as they're discovered,
accepted, and copied into Macro entities. Host-agnostic — chat tools,
Settings → Slack discovery, and the Slack archive import drive the same
primitives, distinguished only by the `initiator` recorded on each row.

Not to be confused with `crates/foreign_entity`: foreign entities stay live in
the external system; an `ImportEntity` here is a ledger row for an item being
copied in, moving `staged` → `importing` → `imported` (or `discarded`). Rows
carry their source `kind`, an optional `parent_id` (the row they were imported
under), and an optional `review_id`; a team keeps one `importing`/`imported`
row per Notion or Linear object (`import_entity_team_object_key`), with a
separate equivalent Jira index.

Notion workspace imports go through a reviewed plan: `ImportFromNotion`
(`plan`) reads the workspace over Notion's REST API (`import_notion`, through
the user's Pipedream grant), asks the decision model what to do with each page
and data source (copy, tasks, skip, or by hand), and stages the plan as ledger
rows. The agent presents it with `PresentReview` (kind `import`) and asks
"Should I kick it off?"; the owner approves on the card or by saying yes, which
has the agent submit it with `DecideReview`. `plan` returns after a short wait
(`PLAN_WAIT`), usually while the run is still `running`, and the agent
presents the review at once: the harness ties the staged rows and the
`running` run (`import_run.review_id`) to the review, so rows staged later
take it too. Planning stages the whole tree as soon as the inventory is read,
each row without a `decision` yet, then writes each decision-model batch's
verdicts onto its rows as it lands (`update_plan_rows`); the report counts
undecided rows as `deciding`, and the write cannot start until the run is
`ready`. A resumed plan stages the tree again, which is idempotent. On
approval the harness starts the write:
folders mirroring the page tree, documents, databases with rows, row bodies and
relations, and task lists as Macro tasks. Each page, row body and task is
created with its Notion page's created and last-edited times (`SourceDates`),
and folders are created dated by what is written into them
(`ProjectService::create_project_dated_by_contents`), so an import of old
pages stays out of Home, which lists documents and folders by `updatedAt`.
The Notion run row tracks it
(`running` → `ready` → `importing` → `completed`/`failed`/`dismissed`).

Every plan carries the user's `sharing` (`team`, `personal`, or `ai`, where
the decision model also answers `shared` per object), stored on the run so an
adopted plan keeps it. A user on a team must choose it
(`ImportError::NotionSharingRequired` tells the agent to ask); a user without
one plans `personal` without being asked, and the report's `onTeam` says
which. Each
plan item records `shared`, `sharedReason` and `shareable`
(`notion_workspace/sharing.rs`). The owner can flip items on the review card;
the draft's `shared`/`personal` lists are written onto the rows before the
write starts. Users without a team keep everything personal. The write
shares documents, databases (with their row bodies' folder) and task-list
folders it makes (`WorkspaceWriter::share_with_team`), and a page's folder only
when everything written inside it is shared, since sharing a folder shares its
contents. A teammate's shared database is linked like a page, but relations
from this import's other databases into it are not linked.

## Start here

- `src/domain/models.rs`: `ImportEntity` and its state machine — read the
  module doc comment for the staged/importing/imported/discarded distinction.
- `src/domain/service.rs` + `src/domain/service/admission.rs`: Slack
  discovery, staging, and acceptance logic.
- `src/outbound/mcp_slack_source.rs`: Slack discovery via MCP tool calls, with
  `fixtures/*.json` backing its tests.
- `src/domain/service/workspace.rs` (+ `run`, `events`, `scan`): shared source-scoped
  leases, adoption, reviews, notifications and the `Importer` plan/write contract.
- `src/domain/service/tracker_workspace.rs` (+ `plan`, `values`): Linear/Jira
  group decisions, frozen source snapshots, task/project writes and relationships.
- `src/domain/service/notion_workspace.rs` (+ `plan`, `triage`, `sharing`,
  `object`, `write`, `values`, `report`): the Notion workspace import —
  planning, the decision model, who sees what, writing one object (claim,
  link or write), cancel and the report.
- `src/inbound/toolset.rs`: the AI-chat-facing import tools
  (`toolset/import_from_notion.rs` is the workspace import tool).
- `src/inbound/axum_router.rs`: the `/import/*` routes (state, accept/decline,
  Slack discovery, the Notion import report and cancel).

## Scope

- Owns: the import ledger, Slack discovery, admission logic, and the AI-chat
  and HTTP entry points into it.
- Not here: live references to external items that never get copied in →
  `crates/foreign_entity`.

## Boundaries

- Depends on: `agent_session` (system events for the session presenting a
  review), `ai_toolset`, `ai_usage`, `ai_billing`, `connection_gateway_client`,
  `mcp_select`, `properties`, `import_notion` (Notion REST), `import_tracker` (tracker snapshots), `models_databases`
  (database ops the workspace import writes).
- Used by: `ai_tools`, `slack_integration`, `services/agent_harness_service`
  (cognition `/import/*` routes, the Notion sweeper, import reviews).

## Recipes

- Add an import source: `src/outbound/<source>.rs` (implement the source port)
  → `src/source_binding.rs` → `src/domain/service.rs`.
- Add a toolset action: `src/inbound/toolset.rs` → `src/domain/service.rs`.
- Add a route: `src/inbound/axum_router.rs` → `src/domain/service.rs`.

## Checks

- `cargo test -p import` (`SQLX_OFFLINE` unset).

## Gotchas

- Workspace imports write through the host's `WorkspaceWriter` (the
  `ai_tools` entity creator), which also implements `EntityCreator`; the
  import service's `N` type parameter is the Notion connection factory, and
  hosts that never call `.with_notion_connections` report Notion as not
  connected.
- Notion page bodies are never parsed here: they go to lexical-service
  (`POST /snapshot/notion`) as Notion markdown with a `NotionLinks` map. The
  workspace write knows every planned page's document id up front
  (`write::notion_links`, derived from the ledger row) so pages mention each
  other; only the import guards
  (`check_notion_markdown`: tool-result wrappers, database-only pages) stay in
  Rust.
- Planning and writing run detached on the host's `TaskTracker`
  (`with_job_shutdown`) and survive their process (`workspace/run.rs`):
  the running process holds a lease on the run row (`lease_owner`,
  `lease_expires_at`, renewed by the heartbeat, recording the job: `scope` or
  `review_id`). A cancel from any process flips the run to `dismissed`; on
  shutdown the job stops at its next checkpoint and releases the lease. A run
  whose lease lapsed is adopted (`FOR UPDATE SKIP LOCKED`) by the next report
  read for that user or by the harness's sweeper (`agent_harness_service::cognition`): planning
  restarts, writing continues with the rows still `importing`. After five
  adoptions the run fails. Stale-run and stale-row reapers skip Notion
  workspace imports for this reason.
- A resumed write never creates anything twice: documents, row bodies and
  tasks get UUIDv5 ids from their ledger row (`WorkspaceWriter` treats an id
  in use as already written), database columns and options UUIDv5 ids from
  their database, and folders, databases, inserted rows, the Page column and
  relation columns are recorded in `import_entity_written` as they are made.
  Every import reuses the user's "Notion" folder (`import_run.root_folder_id`)
  while it exists. Left open: a crash between creating a folder, a database
  or a row batch and recording it duplicates that one object or batch, and a
  crash between applying a schema op and recording it fails that database on
  resume (Macro refuses the column id).
- `team_id` on a Notion row means "the team's copy": only shared objects take
  it, at `claim_importing` (staged → importing) before anything is written, so
  `import_entity_team_object_key` makes a second teammate's claim fail. A
  personal copy never takes it, so teammates never see or link to it and
  import their own copy. Planning marks objects a teammate already imported
  and shared as `alreadyImported` (no decision-model call, not counted as
  copies); the write links them. At write time `claim_team_object` decides per
  shared object: hold the claim and write, link to a finished copy, take over a
  claim whose holder's run has no live lease, or wait. A waiting row is
  checked again after the rest is written, then parks with `waiting_on` the
  holder's row: `mark_imported` links waiters in a second statement (the
  waiter holds the holder's row `FOR SHARE`, so neither misses the other), and
  a holder going back to staged releases its waiters to staged. Waiting rows
  outlive their own run; `settle_importing` leaves them while the holder is
  still being written. Left open: a takeover racing the original holder's own
  resume can leave both copies.
- The agent session presenting a plan's review hears what becomes of it as
  system events (`workspace/events.rs`), each produced in the
  transaction that moves the run (`NotionRunRepo::transition_reviewed_run`,
  through `agent_session`'s `NotificationWriter`): `import.planned` once a
  plan presented while planning is `ready`, and `review.settled` with the
  final report (outcome, counts, failures, by-hand items, root folder) once
  its write ends however it ended; both carry the workspace (`source`:
  Notion, Linear or Jira, Notion when absent) so tracker counts read as
  projects and tasks, including a resumed write and a stalled
  one given up on. A cancel from another process keeps the run `dismissed`,
  so the write's end reports it cancelled. `attach_review` records the
  session (`import_run.review_session_id`); hosts that run Notion imports
  build the ledger with `ai_tools::build_import_repo`, which wires the
  writer. Left open: a writer whose process dies after a cancel never ends,
  so that cancel is not reported.
- The inventory counts each data source's rows, and takes its sample titles,
  from the pages `/v1/search` already returned (every row is a page there);
  only a data source search showed no rows for (a root fetched by id, or an
  empty one) is queried. Plan rows carry the sample titles (`sampleTitles`)
  and a task list's `taskFields` for the review card.
- While planning, the inventory's counts go over a `watch` channel to the run
  row (`scanned_pages`/`scanned_data_sources`, at most every 2s and once at the
  end, `workspace/scan.rs`); `list_runs` and the report show them only
  while the run is `running`.

## Related

- Rules: `.agents/rules/rust/architecture.md`
- Skill: `cloud-storage-hexagonal-architecture`

## Issue tracker workspace imports

`ImportFromLinear` and `ImportFromJira` use the same reviewed lifecycle as Notion.
Hosts register their read-only `import_linear`/`import_jira` connections with
`with_tracker_connections`. `WorkspaceImporter` scopes every operation to the
selected source; `/import/workspaces/{source}` and its `/cancel` route back the
review card. The legacy Notion method and repository names remain for callers.

Plans retain complete issue/group snapshots. The decision model triages groups;
issues inherit copy/skip/hand and sharing. Issues become tasks through ordinary
markdown conversion, comments append to the body, labels become personal tags,
and group projects are initiatives. Project and Parent Task properties link only
targets available in Macro. Assignees match team emails. Source values without a
Macro property equivalent stay in the body.

Tasks and projects use UUIDv5 identities derived from ledger rows. Tasks record a
written marker before relationship enrichment and stay private until it
succeeds; only then are they shared with the team and marked imported. Failures remain staged and appear in the report; replanning preserves
rows with written markers, so retrying a partial write reuses its identity.
Teammate copies are linked without editing them; only the holder keeps `team_id`.
A selected parent/project that failed or is still waiting is reported for retry.
Optional task properties and tags follow the existing best-effort enrichment
contract; original source values remain in the task body.

Jira ids include the cloud id. Epic groups have a separate identity from their
issue task. Tracker imports never use the generic accept/finalize paths; those
paths reject workspace-plan rows so approval cannot be bypassed.
