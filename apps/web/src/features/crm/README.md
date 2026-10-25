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
  crm-route.ts  Route params, record trail, and legacy pipeline link decoding
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
UI rollout gates read `useFeatureFlag` directly where used; do not pass rollout
booleans through component props or the CRM source contract.

Shared entity representations, transport clients, property editors, and
collection mechanics remain shared. CRM owns its record queries and cache updates.
CRM supplies row/header/empty state slots, filter choices, grouping policy, and
its own collection state to the shared collection renderer. Shared collection code must not acquire CRM hooks or
CRM-specific state again.

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
`queries/activity.ts` loads all authorized companies and contacts before
building the feed filters; the capped Quick Access suggestions are not a
complete scope. Notes means Markdown documents excluding task, snippet, and
skill subtypes. Email uses the viewer's mailbox, without team-scope widening.
This reuses existing endpoints without a schema change. Keep the scope complete:
never cap association IDs or fall back to an unfiltered feed. The activity query
memoizes its large filter AST between scope/tab changes. SQL generation batches
OR-ed references into set-membership predicates rather than emitting thousands
of separate subqueries. Email similarly batches participant lists with identical
sender/recipient roles in both candidate and message queries, and omits exact
addresses already covered by a company domain. These backend optimizations must
be deployed to resolve large-scope request stalls.

When changing behavior, test the responsible primitive or pure function. When
moving behavior, retain query keys, persistence keys, mutation ordering, loading
boundaries, routes, and markup. Run CRM tests plus affected shared collection and
user-card tests, TypeScript checking, `just check`, and the real CRM browser flows.
