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
rows. The agent presents it with `PresentReview` (kind `import`). A ready plan
ends with "Should I kick it off?"; the owner approves on the card or by saying
yes, which has the agent submit it with `DecideReview`. A plan still being made
gets no such offer: a yes before it is ready approves nothing (`DecideReview`
refuses), and the `import.planned` system turn that announces it cannot
approve, so the agent tells the user to approve it on the card once it is
ready and says so again when `import.planned` arrives. `plan` returns after a short wait
(`PLAN_WAIT`), usually while the run is still `running`, and the agent
presents the review at once: the harness ties the staged rows and the
`running` run (`import_run.review_id`) to the review, so rows staged later
take it too. Only a `running` or `ready` run takes a review: the harness checks
the report before saving one, and `attach_review` refuses a run that is
failed, being written, finished, cancelled or missing
(`ImportError::RunNotReviewable`, a typed `UnreviewableRun` carrying the kind, never the raw error), so a failed plan never shows as an empty
review. The first review presenting a plan, while it is planned or once it is
ready, holds it (`import_run.review_id`); any other is refused
(`PresentedElsewhere`) until the holder is dismissed (`release_review` frees
the run and its staged rows). Writing starts only through
`start_reviewed_write`: one statement moves the run from `ready` to
`importing` while that review holds it (or, for plans presented before the
run recorded reviews, its staged rows do), and otherwise refuses typed
(`StillPlanning`, `PresentedElsewhere`, `NothingLeft`, failed, finished)
before anything about the plan changes; the owner's sharing choices are
written only once it has started. The first start records the review it
admitted (`import_run.write_review_id`, in the same statement; a new plan
clears it), and only that review may start a write again, and only from
`failed`: a finished write is never retried, and admission is never inferred
from other columns. A failure before the write is held (or
after `reopen_plan` put it back) is `ImportError::NotStarted`, safe to
approve again; once the write is spawned, the returned report is read
without failing the call. `SETTLED` only
says which runs a new plan may replace. A failed plan or write records its
`RunErrorKind` (`import_run.error_kind`, from `failure_kind`; `Interrupted`
when a run is given up on); the report and runs carry it, and the agent's
messages (`explain_failure`, `UnreviewableRun::describe`) and the web
copy are written from the kind. For workspace imports (Notion, Linear and
Jira runs and their rows), a run's and a row's error text is `failure_text`
(a sentence from the kind) and the import settlement carries `error_kind`;
their raw error is only logged, and the report never serializes `error`. The
single-page `ImportNotionPage` path and tracker inventory warnings still
carry raw text (bead mac-il0j). A stored kind this build does not know reads as `Internal`.
The imports tray lists a failed run until it is dismissed or a week has
passed since it last changed, and one that finished with failures (it needs
action) until it is dismissed; `/import/state` itself lists every run.
Planning stages the whole tree as soon as the inventory is read,
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
which. A failed plan's tool answer (`failure_reason` and `FAILED_NEXT` in
`inbound/toolset.rs`) explains the run's `error_kind` and tells the agent to
say it once and not plan again until asked, since a replan fails the same way. Each
plan item records `shared`, `sharedReason` and `shareable`
(`notion_workspace/sharing.rs`). The owner can flip items on the review card;
the draft's `shared`/`personal` lists are written onto the rows before the
write starts. Users without a team keep everything personal. Personal pages,
row bodies and tasks cross `WorkspaceWriter` with `ImportVisibility::Personal`
and are created with link sharing explicitly off, even when the owner team
defaults to TEAM or PUBLIC. Shared verdicts keep the entity/team defaults. New
root and mixed-content folders also start with link sharing off; folders that
contain only shared content retain defaults. Existing entities are not changed.
Convert reviewed sharing once with `ImportVisibility::from_shared`; derive team
and link policy from that verdict instead of passing independent flags. Keep
Shared link defaults when the user has left the team since review; team claims
only control explicit team grants.

Resolve each personal destination through
`ImportServiceImpl::personal_item_folder(user, import_id, destination, path)`.
`WorkspaceWriter::folder_has_explicit_grant` reads the folder and its ancestors
through Projects; links alone do not grant descendant access. An unsafe
folder is mirrored by `personal_mirror_folder(user, path)` under the lazily
created, top-level "Notion (personal)" folder, with Personal subfolders. These
public domain helpers also serve database filing. `notion_workspace/personal.rs`
owns the contract. The root and path identities live on `import_run`
(`personal_root_folder_id`, `personal_folder_ids`), survive subsequent runs,
and are checked for liveness and new grants before reuse. Relocations are
recorded in the item's metadata and listed in the report's warnings. Old shared
folders are never changed.
The write shares documents, databases (with their row bodies' folder) and
task-list folders it makes (`WorkspaceWriter::share_with_team`), and a page's
new shared folder branch only when everything written inside it is shared, since explicitly
sharing a folder grants access to its contents. A teammate's shared database is linked like a page, but relations
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
  link or write), cancel and the report. Database columns and cells come
  from `import_notion::domain::macro_cells`.
- `src/inbound/toolset.rs`: the AI-chat-facing import tools
  (`toolset/import_from_notion.rs` is the workspace import tool).
- `src/inbound/axum_router.rs`: the `/import/*` routes (state, accept/decline,
  Slack discovery, the Notion import report and cancel).
  `axum_router/ledger.rs` serves the ledger tools' operations to the SDK's
  `macro.imports`: `GET|POST /import/entities` (list, stage or record),
  `DELETE /import/entities/{id}` (decline) and `POST /import/notion/pages`
  (one page), with typed outcomes in place of the tools' prose.
  Recording an entity as imported (`record_imported`, shared by
  `CreateImportEntity` and this route) needs the caller to view it
  (`EntityCreator::can_view`, the entity-access view receipt; else
  `EntityNotAccessible`, 403), and never overwrites a row a running import
  holds (`importing`; `ImportRunning`, 409).

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
  while it exists outside trash; a deleted root is replaced on the next write. Left open: a crash between creating a folder, a database
  or a row batch and recording it duplicates that one object or batch, and a
  crash between applying a schema op and recording it fails that database on
  resume (Macro refuses the column id).
- `team_id` on a Notion row means "the team's copy": only shared objects take
  it, at `claim_importing` (staged → importing) before anything is written, so
  `import_entity_team_object_key` makes a second teammate's claim fail. A
  personal copy never takes it, so teammates never see or link to it and
  import their own copy. Planning marks objects a teammate already imported
  and shared as `alreadyImported` (no decision-model call, not counted as
  copies); the write links them. `service/lifecycle.rs` checks finished targets
  through `ImportedTargetReader` during planning and immediately before linking.
  Reviewed Notion, Linear and Jira all use that policy, including tracker tasks
  and initiative project identities. `ImportedTarget` maps ledger types once.
  Inventory reads run with at most eight concurrent requests; generation
  renewals stay sequential so parent and child locks keep a stable order.
  Liveness is independent of viewer permissions: losing access alone never
  renews a still-active target's generation.
  Missing or trashed documents, folders and database entities get a fresh ledger
  generation and write ids on explicit re-import; the old trash copy stays
  untouched. Renewal clears that generation's written markers, team claim and
  obsolete plan link/rationale fields,
  preserves child rows, and never resets an `importing` row. Under the ledger
  row lock the domain rechecks physical liveness, preserving a target restored
  while that lock was pending. A later restore is a separate lifecycle action
  and may coexist with the explicitly requested new copy. Delete handlers
  do not release claims eagerly: liveness checks repair stale claims, including
  deletion between planning and writing. A replacement write uses its own
  generation's document id even if the link snapshot still names the old team
  copy, and clears the review's obsolete `alreadyImported` target. Page, task
  and database-body writes read the run's shared destinations immediately before
  creation, so later writes use a replacement's id while live team ids stay put.
  A missing linked data source requires a fresh plan instead of guessing between
  a database and tasks folder without its original task mapping. Transient
  read errors preserve claims. A finished object deleted during a resumed write
  is staged and reported individually; unrelated objects still finish. Its
  target is omitted from new links. Personal verdicts never acquire the team
  slot when replacing a deleted linked copy. At write time `claim_team_object` decides per
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
  session (`import_run.review_session_id`, returned on the run by
  `/import/state` so the web's import tray can open it); hosts that run Notion imports
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

Keep structural folder roles separate in `import_entity_written`: the ordinary
`folder` marker is personal/mixed, and `folder` with object `shared` is the
all-shared branch. Replace its pointer when a user removed the previous folder's
grant; never restore that grant or add one to the ordinary marker. Reuse a legacy
ordinary folder only while the actual owner's team already has a direct Edit
grant; never promote a mirror folder. Record a separate-folder report warning
when a new visibility branch must be created beside an existing one. The
per-user write lease excludes other processes, and weak per-user async
locks serialize parallel mirror resolutions within a process. Never hold a
process-wide lock across folder creation calls.

Treat a Shared re-review of an incomplete data source as consent to share that
source's existing database, task list and body folders, plus direct grants on
its recorded tasks and row bodies that may have been relocated into the personal
mirror. Do not share a mirror or parent that also holds unrelated personal items.
Personal task imports omit teammate assignees to prevent assignment grants;
persist a typed `WrittenKind::TaskNotice` payload per task. Aggregate notice
counts once per source in report warnings; do not rewrite growing source metadata.
Use a dedicated written kind and typed payload for notices, never document markers.
Older workers reject TaskNotice markers until upgraded; interrupted writes resume
on updated workers. Exclude TaskNotice from resumable-output retention checks;
renewing a deleted generation clears notices and generation-specific folder reports.
Read counts only for Personal items in the current review, reject malformed
payloads, and clear the source's notices after a successful Shared retry. Reapply only the omitted
assignee on marked Notion tasks with this source's omission notice during that retry; preserve contents and other
properties, and keep the source retryable if a roster lookup or assignee write fails.
Strip obsolete claim metadata without rewriting the current reviewed visibility. Preserve
writer-owned folder report fields when staging or updating plans. Keep verdict
updates behind the exact-key lookup fence and recheck the owner on the updated
tuple; stale statistics must not turn a small batch into a user-wide ledger scan.

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

Personal tracker tasks and projects use the same `ImportVisibility::Personal`
policy as Notion items; shared verdicts retain ordinary link defaults.
Tasks and projects use UUIDv5 identities derived from ledger rows. Tasks record a
written marker before relationship enrichment and defer explicit team sharing
until it succeeds; only then are they shared with the team and marked imported.
Failures remain staged and appear in the report; replanning preserves rows with
written markers, so retrying a partial write reuses its identity.
Teammate copies are linked without editing them; only the holder keeps `team_id`.
A selected parent/project that failed or is still waiting is reported for retry.
Optional task properties and tags follow the existing best-effort enrichment
contract; original source values remain in the task body.

Jira ids include the cloud id. Epic groups have a separate identity from their
issue task. Tracker imports never use the generic accept/finalize paths; those
paths reject workspace-plan rows so approval cannot be bypassed.
