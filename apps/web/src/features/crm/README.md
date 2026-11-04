# CRM ownership

CRM company and contact screens, settings, filters, saved views, lists, import,
export, and company actions belong here. The dependency rules are enforced by
`architecture.test.ts` and the feature rules in `rules/ast-grep`.

```text
crm/
  core/         Domain types, permissions, stage resolution, CSV and view validation
  context/      Explicit source/action contracts and scoped providers
  queries/      CRM query factories, cache updates, transport decoding
  primitives/   Reactive workflows: board, filters, stages, views, import, export
  components/   Props-driven presentation and column definitions
  views/        Screens composed from context, primitives, and components
  tests/        Cross-layer CSV integration coverage
  crm.tsx       Company workspace composition
  crm-company.tsx / crm-contact.tsx / crm-settings.tsx
  crm-create.tsx / crm-link.tsx
  crm-actions.ts / crm-hide-action.ts / crm-action-items.ts / crm-user-action.tsx
  crm-search.ts / crm-tool-renderers.tsx
  crm-route.ts  Route params, record and item trails, and legacy pipeline link decoding
  route-views.tsx  Authenticated route and shared-view decoding
  crm-hosted-content.ts  Split content that opens Customers on a pipeline or record
  *-adapter.*   Production sources, navigation, persistence, download, collection wiring
```

App code imports explicit entry points at this directory's root. It must not
import `views`, `primitives`, `queries`, `components`, `core`, or `context`
directly. Avoid adding a catch-all barrel that obscures these entry points.

The root adapters construct production dependencies. `context` defines the
capabilities; it does not import their implementations. Views consume these
capabilities, primitives receive narrow inputs, and components render props.
Core modules remain independent of Solid, service clients, and app state.
`features/notifications/mark-row-seen.ts` integrates with shared list activation so
opening a company or contact clears its row's unread notifications immediately.
It uses the row's attached notifications before falling back to an entity read;
the shared notification source owns optimistic state and failure rollback.
The REST fallback waits for the notification feed before reading its snapshot.
The discussion's message reader remains visibility-gated and reads a separate
global feed, so it cannot guarantee that opening a record clears its row's dot.
UI rollout gates read `useFeatureFlag` directly where used; do not pass rollout
booleans through component props or the CRM source contract.

Shared entity representations, transport clients, property editors, and
collection mechanics remain shared. CRM owns its record queries and cache updates.
Pipeline board positions load through the pipeline-authorized endpoint and are
cached by pipeline and view. Move results update the originating view's cache,
even if the viewer switches boards while saving. The adapter supplies the selected
view ID so switching boards also retires unfinished visual moves and sort prompts.
`browser-test/board.tsx` exercises shared cards, lane composition, and saved ordering with synthetic data.

Successful domain block and unblock mutations evict indexed company rows and
contact suggestions from the GraphQL cache before refreshing CRM and Soup
queries. Refresh mounted GraphQL lists that can contain CRM records too: the
REST mutation returns no changed rows, and hidden records are absent from the
search index. Failed mutations leave those cached records intact.
Company selection snapshots and deduplicates the company's domains, waits for
every domain request, and retains failed domains for retry after the company
disappears from suggestions. Keep successful blocks when another domain fails.
CRM supplies row/header/empty state slots, filter choices, grouping policy, and
its own collection state to the shared collection renderer. Shared collection code must not acquire CRM hooks or
CRM-specific state again.

Visible contact and company toolbars put the archive-system icon beside Copy link.
Archived identities group one Archived chip with a borderless Restore action; on
phones the group wraps beneath the name and Restore retains a 44px touch target.
The chip owns hover/focus/tap explanation; Restore does not trigger that explanation.
`RecordVisibilityAction` handles confirmation, pending, cancellation and retry.
Only admins/owners can change visibility. Company archive cascades to all people
and disables email syncing; company restore explicitly confirms restoring every
person, including individually archived people, while email syncing stays off.
A person under an archived company routes to that company before restoration.
Both information panels start with Record details and References; company-only
Properties, Lists and Email sharing follow, with no duplicate visibility toggle.

People, Companies and company Team use an exclusive Visible/Archived filter.
`people-visibility` keeps the workspace choice local to the account/team/role/view,
preserves search and other display choices, and sanitizes shared/persisted contact
filters. Archived People is current-administered-team scoped, server filtered
before pagination; visible People remains viewer-wide. Team applies the same
exclusive choice to its embedded contact response, including effective parent state.

Successful REST mutations write confirmed flags through the normalized Soup update
path and patch paginated suggestions, company search pages, REST Soup and embedded
detail snapshots. Confirmed detail snapshots become stale without an immediate
refetch; active initial reads that were cancelled are restarted.
Pre-write REST reads are cancelled; the normalized exchange fences older responses
containing or declaring the affected CRM types before publication, hydration or
persistence. Flat and grouped Soup pages retain their initial filter dependencies
on continuations, so old empty pages cannot briefly hide a restored record.
Refreshes target CRM-capable readers, leaving unrelated lists alone. A refresh
failure is logged separately and never misreports a committed save as rejected.
Session identity is captured before dispatch so a late response cannot populate a
replacement session. Ordinary Cmd-K continues to exclude archived companies and
people through its existing feeds and normalized projections; it has no recovery UI.

`browser-test/archive` uses production record headers, toolbar actions, tabs,
SidePanel, Team filtering and confirmations with synthetic storage and isolated
shell services/entity-row metadata. It does not verify authenticated persistence.
`browser-test/people` additionally exercises the production AST compiler and live
GraphQL page source. Exchange tests cover the normalized-cache race boundary.
Run the fixture's `playwright.config.ts` from `apps/web`.
Both hidden mutations emit `crm.visibility_change` through request and cache
refresh completion, with the opaque record ID, record type, requested hidden
state, and outcome. `crm.visibility_change.refresh` times cache invalidation and
the dependent query refreshes before the mutation stops being pending.
`crm.people_visibility` measures the display choice through the next paint;
Soup retains its existing query/loading instrumentation.

`task-composer.ts` owns the CRM task preset: Companies/Contacts are visible,
Status remains a task default but is not initially shown. CRM registers live
`{ task: TaskComposerContext }` values with the provider in
`command/context/create-context.tsx`, scoped to its pane. The app shell owns the
provider and supplies the layout's focus accessor; no global registry or manager
key is involved. The workspace registers the unassociated preset; nested record
getters override it and include already-loaded associations. Teardown restores
the parent getter. Omitted action entries inherit; `task: null` explicitly
suppresses a parent preset when CRM's rollout is disabled.
The selected-record fallback survives detail query errors until the record closes.
Global task creation snapshots the focused pane's getter before opening, without
fetching details or capturing navigation history. Record contexts isolate drafts.

`enable-crm-activity` gates workspace activity tabs and whether CRM supplies its
composer context. It defaults off everywhere and can be overridden locally with
`VITE_ENABLE_CRM_ACTIVITY=true`. Off hides activity navigation and skips activity
queries; saved activity links wait for flag loading, then fall back to Companies.
The standard record task action still associates the task with its record.
The shared composer, registry and launcher never read this flag. With no supplied
context, the standard composer opens immediately. Each opening snapshots its
context; later flag, focus or record changes leave the open draft unchanged.
The Soup and email SQL optimizations are independent of this frontend gate.

The workspace activity feeds are CRM-linked, not unfiltered app shortcuts.
`queries/activity.ts` sends a constant-size `crma: 'activity'` association
selector. CRM resolves every visible company and contact on the server before
Soup filters and paginates the result; the browser does not prefetch the full
CRM or enumerate record IDs in filter trees. The scope excludes hidden records,
including for administrators, and keeps distinct contact IDs even when their
email addresses match. Tasks, Notes and Calls match Companies/Contacts property
links; Notes excludes task, snippet and skill Markdown subtypes. Email matches
visible company domains/contact addresses in the viewer's own mailbox, without
team-scope widening or requiring a property link on the email.

Databases is a row-linked activity view, not a direct database-to-CRM relation.
It opts into database rows with the same server-resolved CRM selector and lists
each containing database once, intersected with authorized database discovery.
A company includes rows linked to its visible contacts; a contact does not inherit
its company's rows. Empty row matches never fall back to all databases. Preserve
Soup pagination and CRM-link invalidation rather than enumerating CRM IDs or table
IDs in the browser. Database creation uses the existing app action; a database
joins the CRM list only after a row has a Companies or Contacts link.

CRM collection and record lists use full-height empty states, horizontally
centered and raised toward the toolbar, with
creation guidance, distinct search-empty actions, retryable error states, and
shared list skeletons with compact single-line rows, small icons, varied title
widths, and supporting metadata columns that hide in narrow panes. Keep search
and available header actions visible in every state. A failed continuation retains
rows and retries that page.
Workspace activity uses the shared single-row desktop header with New and an
expandable Search control; record-detail tabs retain their section toolbar.
Company and contact headers keep desktop section tabs; touch uses a labeled
header island that opens the shared bottom drawer with the current section
checked under **Switch view**. A collapsed host keeps the section icon and
accessible label; embedded phone headers put the switcher below the breadcrumb
and action row. Keep the
workspace's mobile view strip separate. Copy-link islands
are square on touch, with a 24px glyph and the standard 40px icon control.
On touch, record list search has space below the header and fills the row beside
any filter button. Email filters use the shared filter drawer. Each section's
creation action replaces the default floating action above the navigation dock
through `FloatRegion`; keyboard focus, higher-priority composers, and inactive
panes suppress it. Preserve record context, disabled states, and feature gates.
Keep the disabled New email action mounted when company email sync is off so
the unrelated app-wide action does not replace it.
Desktop creation controls remain in the toolbar.

Activity rows render stored Companies and Contacts reference properties as inline
pills through the shared Soup row. Pills use the shared property preview and open
a record independently of the row; additional values use the shared overflow menu.
Email still matches visible company domains and contact addresses for feed
membership, but the row displays only stored properties, not inferred matches.
No separate CRM association metadata lookup or row footer runs during paging.
Linked Tasks, Email, Notes, Calls and Databases open through nested Customers
routes from workspace activity and record sections. Tasks, Emails, Calls and
Databases record sections append only `<item-id>` because their section determines
the renderer; Tasks also omit the redundant `md/task` suffix. These sections reject
redundant typed item URLs rather than retaining fallback routes. Workspace activity
retains `<item-type>/<item-id>` and document metadata; record Files and overview
notes use document-metadata routes restricted to those sections. The route stores
the item name and record trail in entry state. Route params retain the record and
section; pane search retains the workspace tab. `route-adapter.ts` owns item
navigation and close/history restoration. Keep workspace/pipeline item variants
in its shared route-family table and identify history entries through merged route
params instead of enumerating item route IDs.
`views/item-detail.tsx` renders authorized details in the existing CRM shell
with source, record trail and item breadcrumbs, omitting section labels such as
Tasks and Files. The current record breadcrumb returns to the captured section
and entry state. Preview headers append their own live title and menu after the
source trail without an extra separator; do not duplicate the selected title in
the prefix. Modified clicks keep their existing split behavior.
Standalone record previews retain their normal navigation outside the workspace.
Record-detail lists and activity membership remain unchanged.
Sidebar Tasks reuse the production Tasks filters, sort, grouping, and list/board/Gantt
layouts (subject to the normal feature flags and touch fallback). They use a separate
CRM persistence scope, and every query, including search and grouped continuation,
retains the mandatory CRM association. Record-detail Tasks stay unchanged.
Email reuses the shared read/done/attachment/calendar/tag facets. Notes expose creator
and tag filters; Calls expose audience and tag filters. These lists have independent
per-entry search, sort direction, and date/none grouping settings. Date headings follow
the selected sort field in viewer-local time. Email defaults to last-update date groups;
Notes and Calls default to no grouping. Local-only filters continue paging through
empty pages; clearing filters never clears the CRM scope.

Activity extends the existing authorized CRM association path rather than
splitting the feed into independent client queries. This preserves one sorted
cursor and a complete scope without raising GraphQL's filter safety limits.
SQL batching remains useful after resolution, but cannot fix oversized ingress
filters. Deploy the backend association variant before the updated frontend.

When changing behavior, test the responsible primitive or pure function. When
moving behavior, retain query keys, persistence keys, mutation ordering, loading
boundaries, routes, and markup. Run CRM tests plus affected shared collection and
user-card tests, TypeScript checking, `just check`, and the real CRM browser flows.
