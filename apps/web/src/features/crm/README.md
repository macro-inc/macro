# CRM ownership

CRM company and contact screens, settings, filters, saved views, lists, import,
export, and company actions belong here. The dependency rules are enforced by
`architecture.test.ts` and the feature rules in `rules/ast-grep`.

Read `crmAccessAllowed` for navigation and create entry points: pending or failed
proofs keep them visible, while proven denial hides them. Pass
`crmAccessAuthority.allowed` through `CrmContext.canAccess` for record data and
CRM-owned views; the workspace retains its loading, retry, and denied states, and
keeps its sidebar tools (import, export, new list) disabled until access is proven.
Settings is the exception: its Stages and Email sync sections read `accessState`
and stay until access is proven denied, with a retry row after a failed check.
Keep individually shared pipeline navigation available after CRM denial, but
do not open a referenced company or contact. The workspace owns the record
detail gate and unmounts its content on denial; standalone record views retain
their own gate. Close global company/contact creation dialogs on proven denial
and do not navigate to a late successful creation after access has been lost.
The retired CRM/activity/pipeline rollout flags never replace this access gate.
Keep owner-scoped email privacy controls, excluded-thread lists, and email mentions
available after CRM viewing access is revoked. The context always supplies the plain
email mention; privacy settings and the thread header never require CRM record data.
Run the root CRM browser config for its immediate fixtures; the archive and privacy
suites have separate configs and fixture servers in their own directories.

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
Refresh current pipeline queries after a committed create, rename, trash, or
sharing change even when retirement prevents applying the old response locally.

Selective email settings use generated storage-service schemas through the
storage client. The owner/session/team query scope retires drafts on account
changes; each edit pins its observed policy token. Save validates first and
activates only canonical valid rules. Conflicts show the review card without
duplicating the raw server error, keep the draft, and require an
explicit current-policy comparison before admitting a fresh decision. Preview
work starts only on a member action and polls only while its page is open;
unknown or stale counts never appear as current totals. Saved history supplies
verified actor attribution. Rule labels use existing permission-aware identity
previews and retain saved IDs when names cannot be read. Thread labels use only
the batched GraphQL preview; a missing label never loads full email threads.
The same pages render inside the desktop settings shell and phone sheet,
including policy loading and error states. Exclusion loading never appears as
an empty blocklist; failed refreshes retain cached lists with a retry action.
Browser regression coverage
is in `browser-test/privacy/selective.browser.e2e.ts`.

Successful domain block and unblock mutations refresh CRM and Soup email
readers without archiving or restoring records. Failed mutations leave cached
records intact. Privacy settings show the server's mailbox-domain refusal
beside its input and existing-entry warning categories as row descriptions;
company-domain and personal-provider explanations remain distinct.
Company selection snapshots and deduplicates the company's domains, waits for
every domain request, and retains failed domains for retry after the company
disappears from suggestions. Keep successful blocks when another domain fails.
CRM supplies row/header/empty state slots, filter choices, grouping policy, and
its own collection state to the shared collection renderer. Shared collection code must not acquire CRM hooks or
CRM-specific state again.

Visible contact and company toolbars put the archive-system icon beside Copy link.
Archived identities group one Archived chip with a flat secondary Restore button;
on phones the group wraps beneath the name. Keep identity actions and metadata at
the compact property scale: 24px visible height, 12px text and 12px icons.
Interactive controls reserve 10px above and below their touch faces for separate
44px targets; transparent extensions receive those taps without enlarging the paint.
Use flat controls here because the glass finish owns its own press pseudo-elements.
Top-toolbar controls retain their separate navigation scale.
The chip owns hover/focus/tap explanation; Restore does not trigger that explanation.
`RecordVisibilityAction` handles confirmation, pending, cancellation and retry.
Only admins/owners can change visibility. Company archive cascades to all people
and disables email syncing; company restore explicitly confirms restoring every
person, including individually archived people, while email syncing stays off.
A person under an archived company routes to that company before restoration.
Both information panels take their order from `RECORD_PANEL_ORDER`
(`core/record.ts`): Record details, Properties, the company-only Lists and Email
sharing, then References last, so Properties sit ahead of References as in the
app's other side panels; neither has a duplicate visibility toggle. Record
details rows use the side panel's label/value grid
(`SidePanel.Grid`/`SidePanel.Row`), so their labels and values share the
Properties rows' text size, muted label style and label column; long names and
domains wrap. The References empty and error states are muted lines at the
section's text edge, like the Lists section's. A company's Properties pin
Stage, Owner and Revenue before the team's custom properties; a contact's list
only custom properties (a phone number, a LinkedIn link), since the built-in CRM
properties are company-only. Both use the shared `EntityPropertiesSection` and
the same edit rule.

Contact headers and Record details share `ContactEmailField` and
`ContactCompanyField`. The email field lists every address as a Tasks-style
pill, primary first; each pill opens Make primary and Remove, and a trailing
control adds another: an Add email pill while blank, then a 24px ghost icon
button in extra-muted ink, named and tooltipped Add email, like the property
panel's add-value button but with the 12px glyph these controls use. Focused, it
brightens and takes the address pills' ring. The addresses wrap among
themselves inside one Email group, so the add button ends the addresses' last
line instead of taking a line of its own in Record details, and a long address
truncates there. The add control stays one element across both forms,
so focus returned after the first address lands on it. The company pill offers
Add company to any contact without a company, switches only for a
personal-provider primary with no address on the company's domain, and offers
Remove company whenever no address
is on the company's domain (`companyDomain === false`), behind the shared
confirmation dialog. The single address in `companyDomainEmails`
shows no Remove, and a company-domain contact keeps a read-only company value
with its reason in a tooltip. These fields come only from the REST contact
detail; a response without `emails` or `companyDomain` stays read-only.
The separate Go to button navigates without selecting.
Keep these property controls at a 24px visible face with 12px type/icons;
reserve separate 44px touch targets with transparent expansion and margins.
Desktop uses the property popover and entity picker; touch uses the shared dialog
and picker sheet. Drafts remain visible on rejection, pending saves cannot be
repeated, and record identity keys retire drafts when the record changes.
After a desktop email change, return focus to the control that started it, or
to the add control once its address is gone. Property popovers are menus, which
send Tab to their last control; the address editors stop that so Tab reaches
each action. Only committed responses update contact details (the address list
and company eligibility included), both company lists, address lookups and
normalized contact fields, with session and stale-response fences. A lookup
keeps naming the contact only while the contact holds the looked-up address.
The Emails tab sends every address in `eca`, and Files adds one
email-attachment participant leaf per address; the server rejects the whole
Emails request when an address is no longer the contact's, so both read the
committed list.

A company's Record details lists its domains with `CompanyDomainField`, built
like the email field from the same `record-value-editor` shell: one pill per
domain, primary first, each opening Remove, and a trailing Add domain control.
Only the committed response updates the cached company's domain list; the
company's contact details and Team list refresh with it, since which contacts
sit on the company's domains changes, and so does Soup. A refused add keeps its
draft and names the company that already has the domain when the server does.

People, Companies and company Team use an exclusive Visible/Archived filter.
`people-visibility` keeps the workspace choice local to the account/team/role/view,
preserves search and other display choices, and sanitizes shared/persisted contact
filters. Archived People is current-administered-team scoped, server filtered
before pagination; visible People remains viewer-wide. Team reads its contacts a
page at a time from `GET /crm/companies/{id}/contacts/page` (`queries/company-contacts.ts`):
the server applies the Visible/Archived choice (a contact is archived when it or
its company is) and the search, in the order the full list had, and the list loads
the next page as its end scrolls into view. A cursor continues only the company,
Visible/Archived choice and search it came from (anything else answers 400), and the
loaded pages list each contact once. The server's search answer is shown as it
came; only rows of an earlier search, kept while the new one loads, are narrowed
on the client. The company read itself passes `includeContacts=false`. Confirmed visibility and contact edits patch cached Team
pages in place and refresh the lists a contact can move between.

Successful REST mutations write confirmed flags through the normalized Soup update
path and patch paginated suggestions, company search pages, REST Soup and embedded
detail snapshots. Confirmed detail snapshots become stale without an immediate
refetch; active initial reads that were cancelled are restarted.
Pre-write REST reads are cancelled; the normalized exchange fences older responses
containing or declaring the affected CRM types before publication, hydration or
persistence. Flat and grouped Soup pages retain their initial filter dependencies
on continuations, so old empty pages cannot briefly hide a restored record.
Imperative and durable revalidations recover these dependencies at dispatch, before
urql can share them with a later mounted reader. Unknown opaque continuation scopes
conservatively fence both CRM types; known initial scopes retain explicit exclusions.
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

`task-composer.ts` owns the CRM task preset: the records a new task starts
associated with. The Customer / Contact pill belongs to the shared task composer,
not this preset. CRM registers live `{ task: TaskComposerContext }` values with the provider in
`command/context/create-context.tsx`, scoped to its pane. The app shell owns the
provider and supplies the layout's focus accessor; no global registry or manager
key is involved. The workspace registers the unassociated preset; nested record
getters override it and include already-loaded associations. Teardown restores
the parent getter. Omitted action entries inherit; `task: null` explicitly
suppresses a parent preset when CRM's rollout is disabled.
The selected-record fallback survives detail query errors until the record closes.
Global task creation snapshots the focused pane's getter before opening, without
fetching details or capturing navigation history. Record contexts isolate drafts.

The workspace activity tabs are labelled Sales Tasks, Sales Email, Sales Notes and
Sales Calls. CRM supplies its composer context, and the task composer and Universal
Input's task mode show the Customer / Contact pill.
The standard record task action still associates the task with its record.
The registry and launcher never read this flag. With no supplied context, the
standard composer opens immediately. Each opening snapshots its
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

Customers has no Databases view or record section. A database that holds work
outside companies and contacts is a generic pipeline: `recordType` is null, the
primary column starts as an optional Name text column anyone can retype or delete
(the first column then titles rows), and rows are added directly in
the shared editor with no record picker or stage requirements. CSV import needs
a record to resolve, so it is hidden for generic pipelines; export includes Name.
Retired routes keep old links working: middleware sends a record's `databases`
section to the record, and a database opened under Customers to `/database/<id>`.
A saved `databases` workspace tab opens Companies.

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
workspace's mobile view strip separate. Restore that strip when access loss
denies an open CRM record, including one opened from a shared pipeline; keep
independently accessible pipeline items' detail headers unchanged. Copy-link islands
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
Linked Tasks, Email, Notes and Calls open through nested Customers
routes from workspace activity and record sections. Tasks, Emails and Calls
record sections append only `<item-id>` because their section determines
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
Sales Tasks reuse the production Tasks filters, sort, grouping, and list/board/Gantt
layouts (subject to the normal feature flags and touch fallback). They use a separate
CRM persistence scope, and every query, including search and grouped continuation,
retains the mandatory CRM association. Record-detail Tasks stay unchanged.
Sales Email reuses the shared read/done/attachment/calendar/tag facets. Sales Notes expose
creator and tag filters; Sales Calls expose audience and tag filters. These lists have independent
per-entry search, sort direction, and date/none grouping settings. Date headings follow
the selected sort field in viewer-local time. Sales Email defaults to last-update date groups;
Sales Notes and Sales Calls default to no grouping. Local-only filters continue paging through
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

Pipeline stage requirements are CRM policy over the shared database editor.
Remove a required field's rules before deleting its options, since option
deletion clears values even on rows outside the submitted operation batch.
`queries/stage-requirements.ts` adapts the pipeline-authorized rules; the toolbar
opens the shared-control dialog, and Add deal derives its required fields from
stable option/column IDs. Keep drafts on a refused save. The server is authoritative
for table, board, timeline, agent and import writes. Board and timeline creation
use the host composer so stage and date-range defaults reach Add deal. CSV writes split refused batches,
commit valid entries, and show record-specific failures; option labels enter the
local cache only after their batch commits. The backend-free regression is
`bunx playwright test --config src/features/crm/browser-test/playwright.config.ts stage-requirements.browser.e2e.ts`.

A record page's **Add to pipeline** menu (`add-to-pipeline.tsx`, the device
entry; `views/add-to-pipeline.tsx` and `views/mobile/add-to-pipeline.tsx`)
reads nothing until it first opens: `add-to-pipeline-adapter.tsx` then reads
the team's pipelines and the record's rows through the Pipelines card's own
`CrmRecordPipelineEntries` query, cache-first (same document and variables, so
on Overview the normalized cache answers from the card's request), and a
pipeline's table and stage requirements once its stages or add form show; the
menu's requirements read does not poll (a refused add reads them again), and the Add deal form it opens reads no
Quick Access list because its record is fixed. Rows are created with `writeDatabaseRow`
through the pipeline write path the table uses, so the server's stage guard
applies; `core/add-to-pipeline.ts` decides which pipelines a record can join and
whether a stage needs the Add deal form. `ADD_TO_PIPELINE_FLOW` switches between
choosing a stage and always opening the form; `ADDS_AGAIN` says which record
types may join a pipeline twice (companies, as separate deals). An add whose
answer was lost refetches the rows and warns instead of retrying. The
backend-free desktop/phone regression is
`bunx playwright test --config src/features/crm/browser-test/playwright.config.ts add-to-pipeline.browser.e2e.ts`.
