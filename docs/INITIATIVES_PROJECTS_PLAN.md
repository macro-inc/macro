# Initiatives / Projects

Research and delivery plan for Macro task `cEiKHzvtajyg6G48GtZXf`.

- Working branch: `synoet/macro-3564-initiativesprojects`.
- Repository baseline: `b720f71a81`, inspected September 22, 2026.
- This document records the initial backend audit, direct Linear UI research, and delivery plan. The audit describes the baseline before implementation; current behavior is documented in the app agent guides.
- No Macro MCP tools were available in this session; task requirements come from the supplied task content. Backend findings are source-level findings, not claims about deployed behavior.

The accepted delivery is a stack of six draft PRs: access and lifecycle, properties and GraphQL reads, discussions, backend activity, MCP, and the complete frontend. Backend contracts come first. Generated API contracts and minimal compatibility changes accompany their backend PRs. The Projects frontend and shared UI adjustments belong in the final PR; description editing is the last implementation step within that PR.

## Accepted implementation direction

- Project collection/detail, creation, sharing, deletion, task association and
  property APIs use typed GraphQL queries and mutations. Pre-existing initiative
  REST endpoints remain for compatibility; this feature adds no parallel project
  REST read or history API. The shared task discussion transport is unchanged.
  The description editor also reuses the existing document permission-token and
  collaboration transports.
- Projects use the existing task list and grouping technology, task-style
  composer, detail layout, side panel, property controls and Share menu. Any
  focused adjustments required to share those components are part of the
  frontend PR, together with their task/document consumers.
- Overview and Tasks retain Macro's existing tab styling and sit in the top bar
  next to the breadcrumbs, following the channel layout. Opening a project stays
  in the Tasks navigation context.
- Tasks starts directly with the unified task list and controls. The title,
  properties and description belong to Overview.
- Overview uses the same `DocumentConversation` component as tasks, with an
  initiative parent, chronological comments and the composer below. There is no
  Activity tab, custom merged feed or persistent Refresh button.
- Backend activity recording and authorized history remain in scope. Merging
  activity with discussions, and a separate project activity UI, are deferred.
- There are six PRs. Shared UI, task integration, discovery, discussions UI and
  descriptions are all included in PR 6; none is a separate PR.

The backend audit below describes the original baseline. Linear observations
remain research context; the Macro decisions incorporate the user's subsequent
feedback.

## 1. Backend audit

### What already exists

[`crates/initiative`](../crates/initiative/src/lib.rs) owns lifecycle and task membership through domain ports, a service, a PostgreSQL adapter, and HTTP handlers. DSS mounts these routes:

| Operation | Existing route |
| --- | --- |
| Create / list | `POST /initiatives`, `GET /initiatives` |
| Read / update / delete | `GET`, `PATCH`, `DELETE /initiatives/{initiative_id}` |
| Assign or move tasks | `PUT /initiatives/{initiative_id}/tasks` |
| Remove one task | `DELETE /initiatives/{initiative_id}/tasks/{task_id}` |

The [membership schema](../crates/macro_db_client/migrations/20260910144344_create_initiative.sql) already enforces **at most one initiative per task** through the `task_id` primary key. Deleting an initiative removes associations without deleting its tasks. Assignment deduplicates inputs, caps each request at 100 unique tasks, and reports per-task results.

[Initiative access](../crates/entity_access/src/outbound/pg_access_repo/queries/initiative_access.rs) supports explicit user/team/channel grants and link permissions. The [initiative service](../crates/initiative/src/domain/service.rs) enforces owner-only share-policy changes. Members receive edit grants on the initiative and its description document through [member writes](../crates/initiative/src/outbound/pg_initiative_repo/members.rs).

Every initiative already has a required, distinct Markdown description document. [Creation and deletion](../crates/initiative/src/domain/service.rs) coordinate with a document port; DSS supplies the adapter at this baseline; the implementation moves the reusable adapter into [`initiative_documents`](../crates/initiative_documents/src/lib.rs). Link/team/member sharing is coordinated across both entities. Keep this foundation while deferring description editing to the last frontend step.

### Gaps against the task

| Requirement / concern | Finding | Required work |
| --- | --- | --- |
| Status, priority, assignees, due date | [Initiative models](../crates/initiative/src/domain/models.rs) contain none of these. [Property storage types](../crates/models_properties/src/shared/entity_type.rs) have no initiative variant, and [property mapping](../crates/properties/src/domain/model.rs) explicitly returns `None` for initiatives. | Add canonical initiative property support and reuse task system definitions, defaults, validation, and clearing behavior. Do not reuse the existing `PROJECT` storage type. |
| Default team sharing | [Create](../crates/initiative/src/domain/service.rs) shares with the team only for `share_with_team == Some(true)`. An omitted value selects `Unshared`. The team's link-sharing default is a separate setting. | Default new projects to the creator's team using task policy; preserve an explicit opt-out and valid behavior for users without a team. Apply consistently to UI and MCP. |
| Usable permission metadata | [Repository detail conversion](../crates/initiative/src/outbound/pg_initiative_repo.rs) sets `user_access_level` to the constant `View`; [get/update handlers](../crates/initiative/src/inbound/axum_router/get.rs) do not correct it. | Have the domain response reflect the verified caller's effective permission. Owner/editor controls would otherwise be disabled despite authorized requests. |
| Assignments versus collaboration | `member_ids` excludes the owner and grants edit access; it is not a task-style assignee field. | Keep collaborators/access membership distinct from the multi-user Assignees property. The owner must remain assignable. |
| Consistent task mutation authorization | [Assign handler](../crates/initiative/src/inbound/axum_router/assign_tasks.rs) checks task edit access but discards the receipt into a forgeable `Candidate` value. [Unassign](../crates/initiative/src/inbound/axum_router/unassign_task.rs) checks initiative edit access only. Moving checks the destination and task, without an explicit source-project policy. | Define one domain policy for assign/move/remove and carry typed task capabilities or obtain them through an injected domain port. HTTP and MCP must enforce the same rules. Bound/dedupe requests before expensive receipt generation. |
| Task visibility inside projects | [Detail loading](../crates/initiative/src/outbound/pg_initiative_repo.rs) returns every associated task ID without checking each task's visibility. Association itself does not grant task access. | Return authorized task pages/counts, and avoid exposing inaccessible task metadata through activity, chips, or progress totals. |
| Project chip on task rows | `task_initiative` reads/writes are confined to the initiative crate. Task/Soup projections do not expose this association. Existing frontend `projectId` means folder/container. | Add a batched, authorized initiative-reference read and project-scoped task pagination. Preserve the separate folder relationship. |
| Project listing and search | [List](../crates/initiative/src/outbound/pg_initiative_repo/list.rs) returns an unpaginated list with name, description-document ID, and updated time only. No search/filter/sort contract or row properties/counts. | Add cursor pagination, search and required filters/sorts, with useful row projections. Keep discovery scoped to grants/team access; public-link access alone should not enumerate unrelated projects. |
| Activity feed | Initiative service has no event publisher/activity projection. [Activity storage](../crates/activity/src/outbound/pg_activity_repo.rs) already includes initiative among its rankable entity types, but [Soup entity loading](../crates/graphql_soup/src/loaders.rs) rejects initiatives and the current frontend entity-history query depends on Soup. | Publish initiative domain facts into the existing activity pipeline; add authorized entity history, display metadata, audience delivery and refresh behavior. Merely mounting the current entity activity component will not work. |
| New discussions | [`MessageParent`](../crates/messages/src/domain/models.rs) supports only channel/document. [Discussion delivery context](../crates/messages/src/outbound/pg_discussion_context.rs) is document-specific. | Add initiative as a first-class parent throughout messages, access, persistence validation, delivery, notifications and client adapters. General project comments belong to the initiative ID. |
| Share menu | Initiative PATCH supports share policy, but [generic entity mutations](../services/document_storage_service/src/service/entity_mutation.rs) reject initiative sharing. The [global share modal's type set](../apps/web/src/features/sharing/global-share-modal/shareable-entity.ts) excludes initiatives. | Add a view-compatible sharing adapter using the initiative service and existing share UI primitives, with current permission data. |
| Cmd+K | Existing [project commands](../apps/web/src/features/command/useCommandItems.ts) target folder entities; initiatives are not represented by Soup. | Add an initiative-backed command source, display as Projects, and open native project views. Preserve folder search and folder actions. |
| Full MCP coverage | Initiative exposes only HTTP inbound adapters. [`ai_tools::tools_for`](../crates/ai_tools/src/lib.rs) registers existing folder project tools but no initiative tools. [MCP service](../services/mcp_service/src/main.rs) serves that assembled toolset. | Add domain-backed initiative tools plus coverage through property, activity, message and description tools; wire every supported host, generated schemas, result links and frontend renderers. |
| Description last | [The description migration](../crates/macro_db_client/migrations/20260917140621_add_initiative_description_document.up.sql) makes the document mandatory today. Failure compensation can log an orphan if purging fails. | Keep creating the empty backing document. Close lifecycle/cleanup gaps in PR 1, and add the description editor as the last frontend step in PR 6. General project discussions use the initiative parent. |

### Architectural assessment

The hexagonal boundary was checked. Lifecycle and owner-only sharing policy already live in the initiative domain service, with concrete document wiring in DSS. Preserve that shape. Task receipt erasure and asymmetric unassignment checks need a shared domain contract before a second inbound adapter is added. Cross-domain reads and writes should use owning services/ports; initiative, messages and activity adapters must not import each other's outbound modules.

This audit did not execute the existing Rust tests. Existing [service](../crates/initiative/src/domain/service/test.rs), [router](../crates/initiative/src/inbound/axum_router/test.rs), and [repository](../crates/initiative/src/outbound/pg_initiative_repo/test.rs) coverage are starting points for the implementation PRs.

## 2. Linear UI findings and the Macro adaptation

These observations come from direct Computer Use in Linear's signed-in Macro workspace on September 22, 2026. I inspected the project collection, display controls, a project's Overview/Activity/Issues views, status/priority/date pickers, an issue context menu, and the empty new-project form. No project, issue, property, comment or shared view default was submitted or changed. The inspected collection's initial Timeline layout was restored after viewing List.

Primary UI references: [project collection](https://linear.app/macro-eng/projects/all), [project overview](https://linear.app/macro-eng/project/tasks-06c6935d9fc4/overview), [activity](https://linear.app/macro-eng/project/tasks-06c6935d9fc4/activity), [issues](https://linear.app/macro-eng/project/tasks-06c6935d9fc4/issues). These links require workspace access.

| Area | Observed Linear decision | Macro implementation decision |
| --- | --- | --- |
| Collection navigation | Projects has All projects plus saved My Projects and Active projects views; a prominent New project action, filter and display controls. | Add **Projects** to the Tasks view's desktop navigation and mobile tabs. It switches to a project collection with its own filters/search state and New project action. Start with all accessible projects and assignee/status filters. |
| List layout | Compact horizontal rows; name/icon dominate the left, properties align in columns on the right. Collapsible groups have counts and a local create action. This workspace groups by status and subgroups by Linear initiative. | Use the Tasks view's density and tokens. Columns: name, status, priority, assignees, due date, task progress. Default to status grouping, with None available. Reuse column alignment and inline property controls. |
| Display options | List, Board and Timeline; grouping, subgrouping, ordering, closed-project visibility and per-property visibility. | Implement the required list with sorting/grouping and sensible responsive columns. Board, Timeline, saved custom views and nested portfolio grouping are separate scope, not dependencies for this checklist. |
| Detail navigation | Breadcrumb, project name, favorite/actions controls; Overview, Activity and Issues tabs; collapsible project details sidebar. | Native view within Tasks with project breadcrumbs and **Overview / Tasks** tabs in the top bar. Borrow channel tab positioning while retaining existing Macro tab styling. Put the existing Share menu and side-panel controls in the header; restore project identity and tab from navigation. |
| Overview hierarchy | Editable title and summary, compact property strip, description/resources/milestones below. Large screens also show a properties/progress/activity sidebar. | Use the task detail layout and side panel. Overview contains the editable title, task-style properties, description and shared task discussion component. The Tasks tab starts directly with its list. Add description editing last within the frontend PR; omit resources/milestone scaffolding. |
| Inline status | Searchable popover with Backlog, Planned, In Progress, Completed, Canceled in this workspace; keyboard shortcut hint. | Copy the interaction, using Macro's existing task status definitions and icons. Do not silently install Linear's status vocabulary. |
| Inline priority | Searchable No priority / Urgent / High / Medium / Low menu with icon cues. | Reuse Macro's priority property editor, including clearing the value. Keep row, detail and create controls consistent. |
| People | Linear distinguishes a single Lead from multiple Members. | Honor the requested multi-user **Assignees** field. Keep access collaborators in the Share flow; do not create an extra Lead requirement. |
| Dates | Text parsing and a calendar; target dates can be a day, month, quarter, half-year or year. | Reuse Macro's task due-date semantics and date picker. Support set/clear and overdue styling; coarse planning dates and start dates can come later. |
| Create flow | A focused modal includes name, optional summary/description, compact property controls, team selection and one Create project button. | Use a composer closely matching the task composer. Focus name on open; reuse status, priority, assignees and due-date controls with team sharing enabled by default. Submit once, retain values on error and open the created view on success. Description input belongs to the final frontend step. |
| Project tasks | The Issues tab is the familiar issue list scoped to the project, with status groups, filter/display controls and group-level create. | Embed a project-scoped task-list composition. New task supplies the project; Add existing tasks uses the same assignment command as context menus. Opening a task uses existing task detail navigation. |
| Task assignment menu | The issue context menu has Project alongside status, priority, assignee and due date, with a submenu and shortcut hint. | Add **Set project…** with current selection, searchable accessible destinations and **No project**. Share the picker with the task chip and bulk actions. The submenu's selection behavior was not changed during inspection. |
| Activity and comments | Activity contains a Comment/Update composer above a date-grouped stream; system changes are compact actor/action/time rows. Sidebar shows a short activity preview with See all. | Reuse the task discussion component below the Overview description. Comments run oldest-first with the composer beneath them. Keep activity recording on the backend; defer the merged activity/discussion view and health updates. |
| Sharing | The inspected header exposes copy URL and notification controls; properties expose lead/members. | Use Macro's actual permissions model and explicit Share menu. Do not infer that copying Linear's membership UI implements Macro sharing. |
| Visual treatment | Dense type, subtle separators, muted metadata and restrained color on status/priority/avatars; properties open in place. | Use Macro semantic tokens, shared controls and focus styling. Keep navigation, editor state and scroll stable through mutations and background refresh. |

The user request takes precedence over Linear differences: Macro Projects live under Tasks, use task-style assignees/due dates, have default team sharing, and are native views. No Linear-style portfolio initiatives, milestones, dependencies, health updates, charts or roadmap views are required for the first complete release.

## 3. Proposed product and data contracts

### Identity and navigation

- Backend/API/storage entity: `initiative`. Frontend product copy: **Project**.
- New feature: `apps/web/src/features/projects/`; decode `Initiative*` transport DTOs to a feature-owned Project model.
- Preserve existing folder `project`, `projectId`, `/projects` APIs, block routes and tools. New task relationship fields use `initiativeId`/`initiative` internally.
- Register component splits through [componentRegistry](../apps/web/src/components/app/split-layout/componentRegistry.tsx), using a project-specific component identity such as `initiative-view~<id>~<tab>`. Follow existing ID serialization patterns; component params alone are lost on URL restore. Host adapters translate all project links, command results and notification targets into this identity.
- Existing task grouping named `project` currently means folder grouping in [task-query](../apps/web/src/features/tasks-view/queries/task-query.ts). Add a distinct initiative grouping key if grouping is exposed, and label the existing folder operation clearly. Never silently reinterpret persisted folder filters.

### Properties, permissions and membership

1. Reuse Status, Priority, Assignees and Due Date system properties with initiative storage support. Keep one source of truth for values; list/detail projections may include a typed snapshot, not duplicate writable columns. Create applies the same defaults as tasks.
2. Assignees represent responsibility. `memberIds` continues to represent existing collaborators with edit grants; assigning someone is not implemented by rewriting that collection. Any assignee-triggered sharing follows the existing task property's policy through its owning service.
3. Proposed task association policy: editing the task and destination initiative permits assignment/movement. Source-project edit is not additionally required, so a task editor can move their task out of a project they can no longer edit. Removal requires task edit; the initiative-scoped removal endpoint also requires initiative edit. Expose task-side clear through the same domain use case. This is a proposed policy to implement and document, not a claim about today's behavior.
4. Association alone does not grant access to a task or initiative. Project task lists, search, counts and events filter through current access. A task viewer without project access gets a neutral unavailable-project state without its name; a missing association remains distinct from an inaccessible one.
5. New-project sharing defaults to the creator's eligible team. Explicit false stays private unless another explicit grant/link policy applies. No-team creation succeeds without fabricating a team. Share changes remain owner-only; comment access can discuss, edit access can change project metadata, owner access can delete.
6. Deleting a project preserves tasks, removes membership, and cleans up properties, discussions, grants, activity display/cache state and the backing document through owning ports. Account deletion and failed document cleanup must also have deliberate recovery behavior.

### Read contracts and freshness

Use typed GraphQL operations backed by the initiative domain service for project collection/detail/search, lifecycle, sharing and task membership. Reuse GraphQL property operations for project properties and existing authorized Soup GraphQL reads to hydrate task IDs. A complete initiative-as-Soup migration is not necessary to deliver Projects. Add a narrowly scoped task projection or batched lookup through the initiative service, plus paginated task IDs for project detail that hydrate through existing authorized task queries. Keep permission filtering before pagination/counting, not after it.

The collection contract needs cursor, limit, name search, status/priority/assignee/due filters and supported ordering. Return row metadata and caller capabilities without fetching every project's detail. The task relationship contract needs both visible initiative summaries and an explicit unavailable state. Project-scoped task creation must preserve a created task if assignment fails and offer retry, rather than report the whole create as failed and invite duplicate tasks.

Project mutations publish committed events for other sessions and invalidate affected queries locally. A task move updates the task projection and both source/destination project task pages, counts and timestamps. Scope retries to idempotent operations; preserve per-task assignment results for partial failures. A replayed assignment to the same project must not manufacture a move event.

### Backend activity and shared discussions

Use the existing `activity` domain for project lifecycle, property and task-membership facts. Add initiative-specific event projection and materializer wiring, authorized history reads and entity display resolution. Expose authorized history through the owning domain service for MCP and existing activity consumers. A project history frontend source is unnecessary while its UI is deferred.

Use `messages` for comments with parent `{type: "initiative", id}`. Support root comments, replies, edits, tombstones, resolution/reopen and existing applicable reactions/deep links. Initiative comments are unanchored; Markdown/PDF anchors remain document-only. Extend write-access receipts, parent-existence checks, broker/realtime payloads, current-audience notification checks and deletion cleanup. Description comments must not become the project's general discussion store.

The project UI mounts the existing task discussion component directly below the
Overview description. Reuse its ordering, replies, drafts, realtime handling and
permission behavior. The shared messages transport remains unchanged; do not
introduce an initiative-only comment store or transport. A correctly paginated
merged activity/discussion timeline is future work and is not part of this stack.

### Frontend architecture

Follow [FRONTEND_FEATURE_ARCHITECTURE](FRONTEND_FEATURE_ARCHITECTURE.md), including its stronger contracts beyond the current activity example:

```text
features/projects/
  core/        project models, grouping, row projections, route values
  context/     narrow sources/actions and provider; no production imports
  queries/     DTO projection, keys, paging, mutations and cache ownership
  primitives/  collection/detail/create/assignment state and actions
  components/  project rows, chips, property strip and layout; props only
  views/       collection, overview, tasks and create compositions
  projects.tsx production clients, sources and providers
  open-project-in-split.ts  app navigation adapter
```

No `BlockProvider`, block signals, block lifecycle or `block-project` dependencies. The production entry point supplies real sources and permissions; tests inject feature-owned sources. Presentational components do not fetch or navigate. Register the feature in both TS and TSX architecture-rule families.

The Solid/TanStack production playbook (query-key and mutation rules in §11) informed these decisions: complete key factories, one cache owner per domain, reactive inputs, cancellation-aware immutable optimistic writes, rollback and targeted invalidation. These complement the repository's [frontend style rules](STYLE_GUIDE.md). Use shared query infrastructure and retain the existing task/Soup cache instead of copying it into a project store. Include user scope, entity ID and all filter/sort inputs in keys. Retain same-project data during refresh, clear previous-project data on navigation, and release subscriptions with their Solid owner. Derive state rather than synchronizing signals with effects.

## 4. Accepted six-PR stack

Create all six PRs as drafts with Conventional Commit titles. Each PR targets the
preceding branch so its diff contains only that layer. The frontend remains a
single PR, including adjustments to existing shared UI and generated clients.

| PR | Title | Base | Result |
| --- | --- | --- | --- |
| 1 | `fix: close initiative access and lifecycle gaps` | Repository base | Correct permissions, default team sharing, task mutation policy and description cleanup |
| 2 | `feat: add initiative properties and GraphQL APIs` | PR 1 | Task-style properties, typed project APIs and authorized collection/task reads |
| 3 | `feat: support initiative discussions` | PR 2 | Shared discussions accept initiative parents with permissions, delivery and notifications |
| 4 | `feat: record initiative activity` | PR 3 | Backend events, authorized history and existing activity/realtime integration |
| 5 | `feat: add initiative MCP tools` | PR 4 | Domain-backed project tools across supported hosts |
| 6 | `feat: add Projects to Tasks` | PR 5 | Complete native frontend, shared task UI, discovery, discussions and descriptions |

Discussions and activity can be developed independently after their foundation
is ready, but the review branches form one linear stack. Shared UI adjustments,
description editing and discussion presentation do not have separate PRs.

### PR 1 — Access and lifecycle

Make initiatives report effective caller permissions and share with the creator's
team by default, preserving explicit opt-out and no-team behavior. Define one
capability-based domain policy for task assignment, movement and removal, and
keep sharing changes owner-only. Reuse the document domain's cleanup contract
for initiative descriptions and preserve backing-document grants and task data
when deleting a project.

Scope: initiative domain/ports and existing adapters, team-sharing defaults,
description-document lifecycle and the owning document purge boundary. Read
visibility, pagination and task counts belong to PR 2.

### PR 2 — Properties, GraphQL and read visibility

Add Status, Priority, Assignees and Due Date through canonical system properties,
including storage support, defaults, validation, clearing and cleanup. Provide
typed GraphQL collection/detail, create/update/delete, sharing and task-membership
operations backed by the initiative service. Add filtered cursor pagination,
visible task pages/counts and batched task-to-project references without exposing
inaccessible project identities or task metadata.

Scope: property domains and migrations, initiative read/resource ports and
adapters, GraphQL schema/resolvers, DSS composition and generated backend schema.
Use one normalized initiative identity across GraphQL reads and mutations;
filter authorization before paging/counting. Keep collaborators and assignees
distinct, and keep legacy folder relationships unchanged. Existing initiative
REST routes remain for compatibility; new project operations use GraphQL.

### PR 3 — Discussions

Allow root comments and threaded replies on initiatives through the existing
messages system. Apply initiative capabilities and parent lifecycle to reads,
posting, edits, deletion, reactions and discussion state. Include current-audience
realtime delivery and notifications, bot/session parent handling, revocation,
deep-link targets and database cascade cleanup. Anchors remain document-only.

Scope: message models/services/adapters, initiative identity reads through owning
ports, parent constraint migration, notification models/GraphQL projection and
service composition. This extends the shared discussion API; it does not migrate
the common message transport or add the frontend presentation.

### PR 4 — Backend activity

Record initiative lifecycle, property and task-membership changes in Macro's
activity system. Include actor attribution, stable event identities, replay
handling, source/destination invalidation on moves, current-audience delivery
and authorized history through the domain boundary. Preserve task visibility
when events contain child-task references.

Scope: initiative event/history ports, publisher and activity projection,
materializer/event infrastructure, existing activity metadata and realtime
integration. No project Activity tab or merged activity/discussion UI is included.

### PR 5 — MCP

Expose project lifecycle, properties, sharing, task membership, discussions,
history and description access through domain-backed tools. Wire the assembled
toolset into MCP and every supported host. Keep existing folder tools unchanged;
use initiative identifiers internally and explain the Project product name in
tool descriptions. Ship frontend result renderers with PR 6.

| Capability | Tool coverage |
| --- | --- |
| Discover/read | List/search initiatives, details and caller permissions, project tasks and a task's project |
| Lifecycle | Create, rename/update and delete with accurate mutation annotations |
| Properties | Read/set/clear task-style properties through initiative-aware property tools |
| Sharing | Members and supported team/link/channel share policy through the same domain authorization |
| Task membership | Assign, move and remove with per-task outcomes |
| Activity | Authorized paginated initiative history and resolvable entity references |
| Discussions | Read/list threads, post/reply/edit/delete, supported thread state and reactions |
| Description | Discover the backing document and read/edit Markdown through the existing document tools |

### PR 6 — Complete frontend

Add Projects to Tasks using the existing unified list and grouping technology,
a task-style composer and native detail layout with side panel. Place Overview
and Tasks tabs in the top bar with existing tab styling and breadcrumbs. Reuse
the Share menu, property controls and permission-aware actions. Include project
scoped tasks, task chips and context menus, assignment/clear flows, Cmd+K,
restorable links, notification targets, tool renderers and generated clients.

Overview contains the title, properties, description and the same discussion
component used by tasks. Comments are chronological with the composer below;
there is no separate Activity tab or custom merged feed. The Tasks tab starts
directly with its unified task list and controls. Preserve existing task data if
creation succeeds but project assignment fails, with a retry for the association.

Any small shared UI adjustments needed to support native project views belong
here with their existing consumers. Do not add independent extraction PRs.
Collaborative Markdown description editing is the last implementation step in
this PR; reuse the authorized backing-document collaboration transport without
mounting a legacy block provider. Keep description documents out of ordinary
task/project discovery, and retain permission/lifecycle behavior from PR 1.

## 5. Requirement coverage and release checks

| Requested outcome | Owning PRs |
| --- | --- |
| Native views; activity-style feature architecture | 6 |
| Projects tab and unified list/grouping within Tasks | 2, 6 |
| Status, priority, assignees and due dates | 2, 5, 6 |
| Tasks associated with projects | 1–2, 5–6 |
| Project chip column and task context menu | 2, 6 |
| Description editing implemented last | 1, 5; final step of 6 |
| Backend activity recording and authorized history | 4–5 |
| Merged activity/discussion feed or project activity UI | Deferred by user |
| Comments through the new discussions system | 3, 5–6 |
| Cmd+K discovery | 2, 6 |
| Full MCP coverage | 5; renderers in 6 |
| Default team sharing | 1, 5–6 |
| Existing Share menu | 1–2, 6 |
| Typed GraphQL for new project-specific APIs | 2, 6 |

Before each implementation PR lands, run affected package tests and `just check`;
use relevant TypeScript/Rust checks for contract changes. Generate migrations
with `sqlx migrate add`, regenerate SQLx metadata in Nix and run Rust tests from
the root with `SQLX_OFFLINE` unset. Cover domain invariants: effective access,
no-team/default/opt-out sharing, inaccessible tasks, move/removal policy, repeated
and partial assignments, stable pagination, revocation and deletion cleanup.

Verify the complete frontend against a stack containing the new GraphQL schema:
create a team-shared project, change its four properties, add/create/move/remove
tasks, navigate from chips and Cmd+K, adjust sharing, post/reply to discussions,
observe another session's updates and edit the description. Check restored URLs,
mobile navigation, keyboard focus and failed-write recovery. Mirror supported
operations through MCP. Update the task/navigation/discussion app agent guides
with the frontend interaction changes.

Advanced Linear features and merging activity with discussions remain outside
this stack unless the user adds them to the task.
