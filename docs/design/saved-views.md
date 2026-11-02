# Saved views: reusable storage, Tasks first

**Status:** Approved design, implemented on the task-saved-views branch. The
starting point below describes the code before this change; rollout requires
the additive migrations and backend GraphQL schema before the frontend.

## Goal and scope

A saved view is a named, reusable filter definition. Opening it queries live
entities using the current viewer's access, rather than restoring a snapshot of
results. The backend and CRUD client are reusable; the first UI consumer is the
main Tasks screen.

### Agreed behavior

| Concern | Decision |
| --- | --- |
| Ownership | Personal by default; one creator owns the view. |
| Sharing | An optional team share makes the definition discoverable to current teammates. |
| Item access | Sharing never grants access to matching entities. |
| Management | Only the owner can rename, update, delete, share, or unshare. |
| Relative people | “Me” means the current viewer; explicitly selected people remain fixed. |
| Contents | Filters, selected layout, grouping, and ordered sorting, including implicit person conditions. No search text or scroll state. |
| Editing | Explicit Save changes, Reset, and Duplicate. |
| Navigation | Leaving discards temporary edits without a confirmation prompt. |
| Creation | Desktop sidebar `+` or the shared empty-state Create view action starts an unsaved view; mobile also captures changed filters, layout, grouping, or sort in the filter drawer. |
| Capture | Save view appears left of Filters on desktop and in the mobile overlay banner when filters, layout, grouping, or sort differ from built-in tab defaults. |
| Mobile | Shared picker pill after Filters and before built-in tabs; its drawer browses/manages views, while the filter drawer owns save/create/reset actions. |
| Initial surfaces | Main Tasks only; not project or CRM embedded task lists. |
| Owner departure | Team sharing stops while the owner is absent and resumes if they rejoin the shared team. |

No default-view selection, saved-view list reordering, individual recipients,
public links, new task filter categories, or CRM migration are included.
In particular, the current Tasks implementation has no due-date filter;
this feature does not add one.

## Starting point before this change

- [`saved_views`](../../crates/saved_views/src/lib.rs) already stores `id`,
  `user_id`, `name`, arbitrary JSON `config`, and timestamps in `saved_view`.
  Configuration is explicitly consumer-owned.
- [Its PostgreSQL adapter](../../crates/saved_views/src/pgsql.rs) previously
  implemented personal CRUD with shallow-merge PATCH. Ownership checks lived in
  the [DSS REST adapter](../../services/document_storage_service/src/api/saved_views.rs).
  This change moves policy into the domain service and adds GraphQL operations.
- [CRM personal views](../../apps/web/src/features/crm/queries/saved-views.ts)
  use this storage. CRM team views instead live in team CRM settings, and CRM
  share links encode configuration snapshots. Preserve those existing contracts.
- [Tasks state](../../apps/web/src/features/tasks-view/types.ts) mixes filters
  with presentation and navigation state. Do not persist that entire object.
- [Task query construction](../../apps/web/src/features/tasks-view/queries/task-query.ts)
  and [client predicates](../../apps/web/src/features/tasks-view/filters/task-predicates.ts)
  both apply tab scope and facets. My Tasks adds a viewer-relative assignee
  condition; Created by me adds a viewer-relative creator condition. All Tasks
  does not add a team-ID restriction.
- [Tags](../../apps/web/src/features/soup/filters/facets/tag-facet.ts) currently
  require loaded tag metadata to resolve an option to its property definition.
  An unresolved tag stops filtering today. Saved views must not inherit that
  silent broadening behavior.

## Architecture

```text
Tasks UI
  -> Tasks filter-definition adapter
  -> reusable saved-view queries and mutation hooks
  -> generated GraphQL client
  -> GraphQL saved-view adapter
  -> saved_views domain service
       -> saved-view storage port
       -> Teams membership port

Opening a definition
  -> Tasks filter-definition adapter
  -> existing Task query builder and client predicates
  -> existing GraphQL Soup queries and authorized entity sources
```

The saved-view service manages definitions, not result sets. It does not become
another search service or execute a second filter language. Saved views are not
new Soup entities and do not need app-wide favorites, properties, or document
sharing machinery.

Refactor the existing `saved_views` crate in place into domain models, ports,
service, and PostgreSQL adapter. Put authorization and write policy in the
service. Both the existing REST adapter and a new GraphQL adapter call it.
Transport handlers must not retain independent owner or membership policy.

Keep separate create, update, and delete mutation hooks in `features/saved-views`.
Keep `useSavedViews` (paginated list) and `useSavedView` (single definition)
independent and compose them in the host. Read and mutation hooks resolve the
shared GraphQL client reactively; callers supply feature inputs, not clients.
The Task draft primitive receives only the detail source and owns confirmed
filter/layout/grouping/sort snapshots, dirty state, diagnostics, and revision-aware
reconciliation. The Tasks host owns selection, navigation,
and account/task lifecycle. Task actions capture the host request scope before
writing or reloading, reject stale completions, and explicitly select created
views. Mutation dialogs receive a refresh callback, not both query sources.
Compose the list through compound components and reuse styled menu items across
its context and overflow menus. The mobile picker shows rows without a duplicate
section heading or general create button. The compact sidebar and picker empty
state show the heading “Your go-to views”, the muted description “Save your setup
for next time.” and a `secondary`, `sm` Create view button with a leading plus icon, without
a separate illustration. A subtly bordered, rounded container uses 12px padding,
inherits the surrounding background, and has no shadow. The sidebar header's
icon-only plus remains available in every section state, including when the
empty-state button is visible. The empty-state button starts the existing draft
flow after closing the picker. Changes from the
built-in settings expose creation in the filter drawer's overlay banner above the
footer and existing-view save/reset actions at its footer's right.
Starting a new view from the desktop sidebar expands the section and shows one
local, selected New view row labeled Draft in the sidebar and mobile picker.
Confirmed creation replaces the draft with the named record, including while the
list refresh is pending. Canceling the draft or leaving its view removes the row;
closing only the naming dialog retains it. Draft rows never enter the query cache.
Open the shared create/edit dialog or delete confirmation through the imperative
dialog system; dialogs own mutation hooks.
Edit combines the name and team-sharing checkbox in the same responsive form.
Edit and delete dialog titles identify the saved view by name, wrapping long names.
Keep sharing guidance in the adjacent info control, available on hover, keyboard
activation, and tap.
Duplication reuses creation with a prefilled private copy. Keep Task filters, summaries, drafts,
navigation, and rendering in `features/tasks-view`; do not make the generic
feature import Tasks or CRM components.

## Stored filter contract

### Generic resource

Keep the existing JSON `config` column. New consumers use a versioned envelope:

- `kind`: a stable consumer identifier, initially `tasks`.
- `version`: the consumer's definition version, initially `1` for Tasks.
- `filters`: that consumer's declarative filter definition.
- Task-specific `layout`, `groupBy`, and `sort`: selected layout, grouping, and ordered sort fields/directions.

The backend validates generic write bounds and stores the configuration without
interpreting Task fields. It can filter lists by `config.kind`. The consumer owns
a versioned reader that applies supported Task filters and reports skipped conditions.
Existing CRM configurations do not gain mandatory new fields or undergo a rewrite.

This intentionally stores a consumer-owned definition rather than a fully
compiled Soup AST. A compiled AST bakes in the current user, requires reverse
parsing to restore editable controls, and couples persisted definitions to query
transport details. Reuse the existing compiler at execution time instead.

### Task definition v1

The proposed shape below uses explanatory UUID placeholders, not real IDs:

```json
{
  "kind": "tasks",
  "version": 1,
  "layout": "board",
  "groupBy": "priority",
  "sort": [{ "id": "updated_at", "reversed": false }],
  "filters": {
    "statusOptionIds": ["<in-progress-option-uuid>"],
    "priorityOptionIds": [],
    "assignees": [{ "type": "viewer" }],
    "creators": [{ "type": "user", "id": "macro|example@example.com" }],
    "tags": [{
      "propertyDefinitionId": "<tag-property-uuid>",
      "optionId": "<tag-option-uuid>"
    }]
  }
}
```

- Save My Tasks by adding a viewer reference to Assignee; save Created by me by
  adding one to Created by. All Tasks adds neither. There is no separate Scope
  control or persisted scope field.
- Person references are either `{ "type": "viewer" }` or
  `{ "type": "user", "id": "..." }`. The picker distinguishes the relative
  **Me** option from a fixed person. Its tooltip reads “Matches whoever opens this
  saved view.” Do not replace every occurrence of the creator's ID with a viewer token.
- Within each facet, values are alternatives (OR). Different facets combine
  with AND. An empty facet adds no restriction.
- Persist stable status and priority option IDs, not display labels. Persist
  both tag IDs so inaccessible or deleted tag metadata cannot erase a clause.
- Capture the actual open-status selection when present. Do not depend on
  whatever default statuses a future client chooses.
- Capturing My Tasks with an additional assignee uses normal OR matching: tasks
  assigned to either person. Created by me follows the same rule for creators.
- Accept only this final definition format. Earlier experimental Scope-based
  configurations are not deployed contracts and have no upgrade path.

Materialization always uses the All Tasks tab and restores every restriction as
an editable facet. Viewer references resolve at query time. The same definition
must feed list, board, Gantt, client predicates, and temporary text-search
requests. Search text is not saved, but search results must satisfy every saved
filter. In particular, search must use stored tag bindings rather than silently
dropping tags absent from the viewer's metadata. If a search backend cannot
express a condition, block that search with an explicit unsupported state;
never run it with fewer conditions. Layout, grouping, and sort changes dirty the
saved definition and participate in Save changes, Reset, and Duplicate. Missing
layout, grouping, and sort use List, Priority, and updated-at descending defaults.
Unsupported layouts fall back to List; unsupported grouping falls back to Priority;
unsupported sort entries are skipped, preserving supported order,
with updated-at descending used when no supported sort remains. Mobile and
feature-flag fallbacks never replace the raw selected layout on save.

Apply supported conditions immediately, omitting unsupported or malformed entries
and conflicting tag bindings. Show a danger-colored banner above the results that
identifies skipped filters or view settings without an additional description. If no supported
conditions remain, show the unfiltered All Tasks list, including closed tasks;
unknown formats also show this list with the banner. Keep missing or unauthorized
definitions in the unavailable state, without executing task queries.

Reading never modifies the stored definition and never starts a recovery workflow.
Ordinary Save changes is disabled while any unsupported or invalid setting
remains, preventing an older reader from overwriting settings it cannot represent.
Edit preserves the raw configuration; Duplicate warns before omitting
unsupported settings. Only explicit Remove & save replaces the original with
supported settings. Missing person or tag labels retain their exact filter IDs
because these conditions remain executable. A missing authenticated viewer blocks relative-filter execution.

For dirty-state comparison, deduplicate and order set-valued filters. Reordering
a selection alone is not a change. One Task codec owns capture, validation,
materialization, and comparison; do not store both facets and an independently
editable compiled AST.

### Client-version safety

Keep additions independently readable within a compatible definition version.
Older guarded clients apply known settings and show a warning for unknown fields.
Revision checks prevent stale writes, but do not prove a client understands every
field. Do not rely on them for schema compatibility. Before enabling a breaking
format or new settings for already-shipped clients without this write guard,
require a backend write-version check or update those clients first; the generic
backend currently stores opaque JSON and does not enforce reader capabilities.

## Ownership, sharing, and lifecycle

A caller can read a definition when they own it, or when its effective team share
is valid and they currently belong to that team. Only the owner can write it.
The server derives the owner from the authenticated request, never from input.
Enabling sharing requires the owner to belong to the selected team. A viewer can
save a personal copy of another person's shared definition.

Every result query still uses the viewer's existing entity permissions. A shared
All Tasks view can include the viewer's private tasks; team sharing controls who
can open the definition, not which entities it selects.

### Sharing follows current membership

A share stores only a nullable `shared_team_id`. Both its owner and its viewer
must currently belong to that team. Owner-only writes and item permissions remain
independent of this visibility check.

Leaving immediately makes the share ineffective; rejoining the same team restores
it. A failed membership removal that restores membership has the same effect.
This follows the existing current-membership sharing pattern, replacing the
earlier proposed permanent-revocation policy. It needs no membership-lifetime
column or changes to Teams' join, removal, or compensation flows.

Unsharing explicitly clears `shared_team_id`. A deleted team makes the view
private, not deleted. When an owner is absent, API responses hide the ineffective
share without clearing the stored team association.

The Teams-owned `TeamRepository` supplies authoritative current memberships:
reuse `get_user_teams` to narrow the views fetched for access checks and
`get_all_team_members` for each distinct team through the saved-view membership
adapter. The saved-view domain checks that each view's owner and viewer are both
in that team's member list, including team owners. Saved-view storage owns
definition persistence. Do not query or mutate `team_user` directly from GraphQL
resolvers or saved-view storage. Listing fetches batches with
`list_views_for_access_check`, applies visibility before its public pagination
limit, and fetches one member list per team in each batch, not per view. Recheck
previously collected views on later batches; the initial team list only narrows
the views fetched for access checks.

## Persistence and GraphQL

Add an internal integer revision, starting at one, to `saved_view`. All writes,
including existing REST writes, advance it. Add owner and shared-team indexes
with stable created-time/ID ordering; keep optional kind filtering without
speculative kind-specific indexes. Existing rows remain private and retain their
configuration. Consolidate unpublished migrations into the minimum safe final
set, retaining separate concurrent-index statements and lock timeouts.

Expose reads under the authenticated `user`, following the
[GraphQL field guide](../guides/add-graphql-field.md):

| Operation | Contract |
| --- | --- |
| `user.savedViews` | Visible owned and shared definitions; optional kind filter and bounded cursor pagination. |
| `user.savedView(id)` | An authorized definition, or not found. |
| `createSavedView` | Stable client-generated ID, name, config, and optional team share; private by default. |
| `updateSavedView` | ID, expected revision, and optional name, replacement config, or explicit sharing change. |
| `deleteSavedView` | ID and expected revision; returns the deleted ID. |

The normalized output object has `id: ID!`, owner ID, name, config, effective
shared team ID, revision, and timestamps. Generate the GraphQL envelope types and
SDL; the frontend-owned JSON schema is not a second handwritten GraphQL DTO.

Updates distinguish omission from clearing. Omitted fields stay unchanged;
private sharing is explicit. A submitted config replaces the whole definition.
Retain legacy REST shallow-merge behavior through an explicit domain update
operation, rather than changing CRM's existing PATCH semantics.

Stale revisions return a terminal conflict and preserve the newer record. Keep
the draft so the user can reload or save a separate copy. Retried creation with
the same owned ID returns the existing resource without overwriting it; retried
deletion of an absent ID is harmless. A permanent ID-only tombstone prevents a
late create retry from resurrecting a deleted view. Keep physical deletion so
older REST readers still see absence, not an empty soft-deleted row. Serialize
create/delete in upgraded writers with the same per-ID transaction lock. The
deletion trigger captures old REST deletes and account cascades without taking
that advisory lock after its row lock. Creation rechecks tombstones after INSERT
and rolls back if a legacy deletion committed while INSERT waited. Tombstones
contain no names, filters, or owner foreign key, and must not be purged. GraphQL
permission, conflict, and validation errors must not become transport retries
that block the mutation queue.

Return authoritative records from create/update and the deleted identity from
delete. Reconcile affected collection membership in the shared GraphQL cache;
normalizing a record alone does not insert or remove connection edges. Preserve
cursor-page boundaries when inserting, removing, or moving a record between
kind-filtered collections, including when the first page is full. Do not
optimistically invent sharing permission. Use the established live-query and
mutation-policy machinery, not a second TanStack persistence path for Tasks.

Mutation responses use primary-backed data. Membership evidence also requires
authoritative reads, not a stale replica or browser cache. Revalidate collections
on opening/foregrounding the surface. V1 does not introduce a dedicated realtime
subscription; cross-client changes appear on revalidation. Every server operation
still checks current access, irrespective of cached UI state.

## UI and navigation

### Desktop

Add a **Saved views** section to `TasksSidebar`, after the built-in navigation.
Keep the heading and its accessible, icon-only `+` available when the section is
empty, collapsed, loading, or in an error state. Rows show the name, active state,
and a team-sharing indicator where applicable. Use the existing sidebar and
control primitives.

The desktop main pane displays the selected view's bookmark icon before its name
and its unframed ghost overflow button immediately after it, plus the normal Task
controls.
Provide matching sidebar context/overflow and selected-view overflow menus with
Edit, Duplicate, Copy link, and confirmed Delete.
Wrap menu items in the existing padded groups. Non-owners get only actions they
can perform; backend enforcement remains authoritative. Edit updates the name
and sharing together, preserving temporary filters, layout, grouping, and sort without saving
them. Create and Edit use the same 600px-wide dialog, capped to the viewport;
unchanged sharing is omitted from updates.

On desktop, show **Save view** immediately left of Filters when filters, layout,
grouping, or sort differ from the built-in tab defaults. It captures structured
filters, implicit person conditions, layout, grouping, and ordered sorting,
excluding search. Show a short reminder when search is active so the saved definition is
not mistaken for the visible search results.

### Drafts and explicit saving

- The desktop sidebar's `+` starts a transient New view with no person
  restrictions and the normal open-status filters. Nothing is persisted until
  Save view succeeds.
- Reuse the Task filter controls to configure it. Saving prefills the name with
  New view, which can be edited, and offers optional team sharing. Cancel restores
  normal navigation without persistence.
- Opening a saved view replaces the prior filter scope rather than intersecting
  with the previously selected built-in tab. Clear unrelated text search.
- Changes show Save changes and Reset for the owner. All viewers can Duplicate
  with a prefilled “(copy)” name; copies are private unless explicitly shared.
  Duplicating the selected view includes temporary filters, layout, grouping, and sort;
  duplicating another sidebar view uses that view's saved definition. Other viewers cannot overwrite
  the shared definition.
- Only a confirmed write updates the saved baseline. Failures keep the draft and
  its inputs. Leaving the view discards temporary settings, including when a
  background save fails after navigation.
- Task-detail navigation and its return breadcrumb retain the originating saved
  view identity, but do not persist an unsaved filter draft. Scope async results
  to the account, selected view, and revision before installing them. A confirmed
  deletion also exits its target if the same account selected it during the request.

### Mobile

Tasks has navigation pills and a filter drawer, not a mobile sidebar. The shared
`MobileDrawer` picker shows the named list and active saved-view name without a
duplicate section heading or `+` button. Keep the active name in the picker pill
without repeating a title/menu or action row below the tabs. Preserve built-in
navigation and existing mobile list-only behavior.

Show a filled Save view button with a leading bookmark icon in a borderless,
edge-to-edge info banner overlaying filter content immediately above the footer
only when filters, layout, grouping, or sort differ from the built-in tab defaults.
Base settings and search alone do not show the banner.
Keep the banner fixed while content scrolls behind it, with a drawer-colored
backing and enough scroll clearance to expose the last controls. Use the unpunctuated copy “Save these filters as a view”.
An unsaved view also has Cancel whenever its changed settings show the banner.
For an existing saved view, show a filled Save changes button and a secondary Reset
at the footer's right, opposite Clear all, while settings are dirty. Keep these
actions available when all filters are cleared or only sorting changes. Preserve
the stored desktop layout.

Provide management through each saved-view row's visible overflow button in the
picker. Use existing dialog/drawer conventions for naming, sharing, conflicts,
and delete confirmation. Keep row menus inside the picker's portal scope for
keyboard access. Close the picker and restore its trigger focus before opening
a management dialog; discard queued actions when the account changes. Saving
from the filter drawer closes it before opening the name dialog. Cancel or Escape
reopens the current filters only if the navigation scope is unchanged; a confirmed
creation selects the new view without reopening the drawer. No hover-only controls
or desktop-only management actions.

### URLs and unavailable views

Extend the Tasks route/search codec with a stable `savedView` ID, for example
`/app/component/tasks?savedView=<uuid>`. Links identify the stored definition;
they do not serialize filters or bypass sharing. A private link stays private.
Preserve the normal Task-detail route composition and split behavior.

A missing, deleted, unshared, or inaccessible view shows an unavailable state
with a return-to-Tasks action. Do not fall back to All Tasks under the saved
view's name. A list failure retains already loaded rows with a retry action.
Unsupported or malformed filter conditions are skipped with the danger banner;
if none apply, show unfiltered tasks. Duplication warns before saving a copy that
omits these conditions and leaves the original unchanged.
Keep the banner concise: name skipped filters and view settings without a description.
Owners can explicitly choose **Remove & save** at its right edge.
This revision-checked update keeps supported stored conditions, layout, grouping, sort, and
sharing unchanged; it does not save temporary edits. Failed writes retain the
warning and stored definition, and conflicts offer a reload. Only a confirmed update clears the warning.

## Delivery and review boundaries

Implement in focused slices, with behavior checks alongside each slice:

1. Versioned Task definition codec and generic saved-view domain/storage design;
   additive team-sharing and revision migrations with current-membership checks.
2. GraphQL adapter, viewer reads, service wiring, generated contracts, and mutation
   cache policy. Preserve existing REST/CRM behavior.
3. Reusable frontend queries/mutations, Task-owned drafts, and the main Tasks desktop/mobile integration.
   Keep project and CRM embedded Task consumers unchanged.
4. Update the Tasks agent guide and affected crate guidance; exercise permissions,
   multiple viewers, revision conflicts, missing filters, and navigation in the
   local app before rollout.

Deploy the additive database changes and upgrade all backend writers before
enabling the frontend consumer, so concurrent REST writes advance revisions.
Do not add a REST fallback when the new schema is unavailable. Reuse existing
tracing across writes and filter loading without logging names, configuration
contents, or person identifiers.

### Points for design review

- Consumer-owned, versioned filter definitions are recommended over storing a
  compiled Soup AST or the entire Task view state.
- Team visibility follows current owner and viewer membership, matching existing
  sharing patterns rather than introducing membership lifetimes.
- Cross-client changes revalidate rather than using a new realtime subscription.
- No existing CRM views are migrated or reinterpreted in this feature.
