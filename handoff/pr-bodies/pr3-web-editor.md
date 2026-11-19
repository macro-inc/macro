## Why

A routine can define work once and schedule it for many items. For example,
one reminder definition can take a task and run on a different trigger for each
task. The editor dropped definitions and program input values when rebuilding
tasks on save. A scheduled copy stores the name and values needed to resolve
its steps from the parent.

## How it works

```text
parent routine                     scheduled copy
steps schedule "remind" ─────────▶ trigger + { sub_routine: "remind", inputs }
sub_routines["remind"] ◀─────────── resolve steps from the parent on each run
                                   Keep as my routine → standalone program
```

Each run reads the current parent definition. A copy has its own trigger and
settings. **Keep as my routine** materializes the referenced definition's
steps, apps and input values and carries forward the parent's definitions.

## What

- Preserve definitions and program input values in draft storage, create and
  update, including new routines with one Ask AI step. Newly serialized programs
  omit empty definition and input collections. Rebuilt definitions always
  include `mcp_servers`, including an explicit empty array when clearing the
  last app.
- Check the combined code-step budget, available connection data and each
  app-backed Ask AI target in the main routine and in definitions. A resolved
  external agent blocks the form with guidance to change **Who** or remove the
  apps, and a failed roster refetch keeps the cached agent, so the block
  holds. The scheduler checks unresolved agent selections.
- Resolve the named definition on a copy page and show the supplied values,
  instructions and source. A loaded parent with a missing definition or
  incompatible inputs hides **Run now**, on the copy's page and on its row
  when the list holds the parent. Long step text and app names wrap. The
  parent link and **Created by** show their full labels in the shared
  tooltip and wrap on touch; they and **Retry definition**, the code
  disclosure and app removal use the shared Button sizes rather than
  per-call-site heights. The **Routine actions** trigger retains the shared
  Button's 36 px touch minimum used on main.
- New interface text (the definition review notice, approval actions and
  their failure toasts, Delete's notes, definition and app validation
  messages) goes through translation keys, in English until the periodic
  translation update; Follow-ups names the one reason that doesn't. `vite-env.d.ts`
  declares the `VITE_ENABLE_SUB_ROUTINES` override of the
  `enable-sub-routines` flag.
- Keep and Duplicate use the same eligibility checks across the detail and
  row menus. The list defers connection reads until a row menu opens with a
  candidate requiring apps. A model-only field loads agent choices when its
  picker opens.
  - **Keep as my routine** supports ordinary sub-routines. A reference-backed
    copy needs its named definition, matching inputs, no known active run
    claim, and connected apps across the retained definitions. An app-free
    copy needs no connection read. Run start and stop notifications patch
    the claim in cached rows at once, and a routine detail, routine list,
    active-copy or children read already in flight keeps the newest claim
    seen while it ran instead of restoring the old one (so **Keep** stays
    hidden while a copy runs); an active list read that
    overlapped a stop is read again for its rows. Detach moves the row from
    child caches to the main list immediately.
  - **Delete**'s confirmation, from the routine's page or a row's menu,
    names the sub-routines deleted with a routine: the count already loaded
    at once, then the count a fresh children read finds (main's page used
    the loaded count only). That read waits out a children read already in
    flight and reads again (or joins the read a run's stop queued after
    it), so it counts a child a finishing run just made. A run still going can make one after any
    read, so the count is what Delete's read found; the delete removes
    every sub-routine either way (the parent key cascades), as on main.
    The scheduler lists only the newest 200 one-time routines with no next
    run (a run still in progress included), so when the read finds that
    many the note says **At least N**. Until the read answers, or when it
    fails, the count the page already holds is given as a floor (**At
    least N**, or **Any routines it created will be deleted too.** when it
    holds none), so confirming at once still warns. The read is an
    interaction of its own (`routine.delete_count`), recording the count,
    whether it is a floor, and a failed read as an error. A sub-routine
    creates none of its own: its Delete reads nothing and has no note.
  - **Duplicate** uses the saved trigger and a task with its own steps or
    instructions, from either menu, also when the editor can't open those
    steps. It checks retained definition connections. The create
    contract treats an unfired overdue one-time occurrence as immediately due.
- The owner's `enable-sub-routines` flag gates creating and changing tasks
  with definitions or program input values and duplicating such tasks. Owners
  can keep compatible copies and save metadata while that flag is off. The
  scheduler uses the flag to gate scheduling new copies. Independently,
  `enable-event-routines` gates Duplicate, approval and keeping a
  reference copy (the detach that runs the scheduler's event checks) for
  triggers that include events.
- When an owner's routine cannot be shared and sharing is enabled, opening
  **Routine actions** checks whether **Stop sharing** applies. The menu also
  checks when eligibility changes while open. It reuses status for up to five
  minutes. **Stop sharing** cancels the in-flight status read before caching
  revocation. A cached snapshot stays actionable after refresh failure.
  **Retry sharing status** appears after an initial failure.
- The notice to review rewritten code covers the definitions' code beside
  the routine's own, and stays on screen when a background refresh of the
  code updates fails, from the proposal the page already holds.
  Disable approval until autosave is clean and the form has no validation
  error. Approval reads the routine fresh, compares its task to the
  proposal's baseline, and withdraws the notice with an explanation if it
  changed. It stops, keeping the newer routine, if the detail or list cache
  already holds a higher configuration revision than the read, and checks
  both again just before saving.
  It locks settings during the check and save and reports failures
  to resume or refresh review status separately.
- A knob whose picked item needs a new pick (main's entity knobs) is
  marked in the sub-routine holding it, by the scheduler's `sub_routine`,
  and never on the routine's own step that shares its step id and knob
  name. The page asks for those knobs when only a definition picks an item
  too.
- Keep, Duplicate, Stop sharing, sharing status and retry, approval, and
  definition retry use interaction traces that hold through asynchronous work
  and record failures. Work and explicit refresh retries carry the parent
  trace. Cold definition loading uses the enclosing view's loading flow and
  records a failed parent read as an error.

## Database review

No SQL is added or changed here. The routine actions menu uses the existing
template read (`GET /scheduled-actions/{id}/template`, `get_template`) to
offer Stop sharing when it opens on a copy or a routine with definitions or
input values, or when that condition first applies while it is open. The
owner needs the sharing flag. A fresh result is reused for five minutes
per routine. The same read runs on main when the sharing panel opens.

The template count was measured with `EXPLAIN (ANALYZE, BUFFERS)` on a
Postgres 18 scratch database with 1.2M routines, one template activated
100,000 times and nine activated 1,000 times each:

| Query | Rows | Plan | Measured |
| --- | --- | --- | --- |
| `get_template`, unchanged: the template by its routine id, with a count of the routines activated from it | 1 template; the count reads that template's activations | The seed scanned ten templates sequentially. `scheduled_action_template_pkey` is available. The source routine uses `scheduled_action_pkey`, and the count uses an index-only scan of the partial `scheduled_action_template_id_idx` | 100,000 activations: 7.4 ms, 86 buffers after vacuum (12.7 ms, 2,705 buffers with every heap page unvisited); 1,000 activations: 0.16 ms, 8 buffers; a routine never shared: 0.02 ms, 1 buffer. Custom and generic plans are the same. |

The count grows with a template's activations. Approval also adds a fresh
one-row routine read by `scheduled_action_pkey` before the PUT.

The other reads are existing endpoints under their existing query keys.
Where this branch calls them from somewhere main doesn't:

| Read | Main calls it | This branch also calls it | Per request |
| --- | --- | --- | --- |
| Connections: `GET /pipedream/mcp/connections`, `/mcp/servers`, `/pipedream/mcp/overlays` | On New and an owned routine's page, always | When a row's menu opens on the routines list or in Settings and Keep or Duplicate would retain definitions with apps | The viewer's connections by `pipedream_mcp_connections_pkey`, their servers by `idx_mcp_servers_user_id`, and the overlay catalog by `mcp_overlays_pkey` |
| Roster `GET /agents` | When an Ask AI step's prompt editor or **Who** shows | When a definition's Ask AI step, or a copy's read-only parent step, is expanded; when an app-backed step names an agent | The viewer's own, team and selected-channel agents, as on main |
| Runtimes `GET /harnesses/directory`, `GET /cursor-api-key`, `POST /agent-models/load` | When **Who** opens or a saved agent shows, and for model defaults | The same, in a definition's or a copy's Ask AI step | The team's visible runtimes with their access checks, as on main |
| Routine list `GET /scheduled-actions?include_events=true` | On the routines list, and on a routine's page, whose source reads it beside the detail | On a copy's page, the same source, which also finds the parent there; **Retry definition** refetches it only after the first load failed | Main's list read |

None of these was measured here: each request is main's query at main's
scope, for one viewer, and the new callers are a menu, an expanded step or
a retry. The connection reads refetch whenever a component using them
mounts (`refetchOnMount: 'always'`, as on main's pages), so each such menu
opening costs the three requests once; the others are answered from the
shared cache for their stale time.

Two callers read the routine lists more often than main in a race:

- A run's stop notification on main invalidates the list, active-copy and
  children queries, which cancels a loaded query's read in flight and
  starts another, but joins a first load's read and leaves its rows as
  they were before the run. Here a read in flight finishes and the query
  is read once more after it, so a loaded query makes the same two
  requests per stop as on main (main abandons its first after sending it),
  and a query on its first load
  makes one more than main's one, which is what lets it show the children
  the run made.
- **Delete** of a top-level routine reads its children, as main's row
  menu does, and now also from the routine's page (one children read per
  Delete opened there, even if cancelled); Delete of a sub-routine reads
  none, from either place. When a read of them is already in flight it
  waits for that read and reads once more (or joins the read a stop queued
  after it): at most one more children read per Delete opened during a
  read.

Both repeat main's list queries at main's scope, at most once more per
in-flight read. Main's statements were measured with `EXPLAIN (ANALYZE,
BUFFERS)`, custom and generic plans, on a Postgres 18 scratch database with
1M routines (1.1M after adding a 100,000-child parent without a new
`ANALYZE`), parents of 100,000 children (50 active, the rest finished
one-time copies) and of 1,000, 2.9M run records (one routine with 100,000),
10.9M access rows, and viewers reaching 5,000 and 50 routines:

| Statement (main's, unchanged) | Relies on | Measured |
| --- | --- | --- |
| A routine's children (`GET ?parent=`): active arm, then the newest 200 finished | `scheduled_action_active_children_idx`; `scheduled_action_parent_run_idx` backwards | 100,000-child parent: 250 rows, 226 finished candidates read, 39 to 56 buffers, 0.09 to 0.18 ms, fresh or stale statistics; no plan read a whole family |
| Latest run per listed routine (`CROSS JOIN LATERAL ... LIMIT 1`) | `action_execution_record_action_id_idx` | one probe per routine, including the 100,000-run one: 250 probes 0.35 to 2.3 ms; 5,000 probes 11 to 28 ms |
| The viewer's sources (cache miss) | active-channel and team membership indexes | 5,002 sources, 0.8 to 1.0 ms |
| Granted routine ids for those sources | `idx_entity_access_source_type_entity_plain` (generic plan, small viewer) | 5,000-routine viewer: generic plan 54 to 73 ms; the custom plan walks `scheduled_action_pkey` whole (1M to 1.1M entries) in 167 to 228 ms. 50-routine viewer: index plan |
| Top-level rows by those ids; active children of those parents | `scheduled_action_pkey`; `scheduled_action_active_children_idx` | 5,000 ids: 12 to 28 ms; 5,000 parents: 130 to 180 rows, 0.8 to 1.2 ms |

The extra pass a stop adds to a list still on its first load repeats this
work once, so for a viewer who reaches 5,000 routines it costs up to about
0.3 s of database time per stop in that window; Delete's extra read is one
children read, the children statement and at most 250 latest-run probes
(under 3 ms measured for a 100,000-child parent). The grant lookup's custom plan, which scans the whole
routine index for a large viewer, is main's on every list read; see
Follow-ups. These plans were measured on Postgres 18 (dev's version) only;
how Postgres 14 (prod's, `infra/stacks/macrodb/Pulumi.prod.yaml`) plans the
children statement for a parent with skewed children was not checked.

## Follow-ups

- Main's lookup of a viewer's granted routines can choose a plan that
  scans `scheduled_action_pkey` whole for a viewer reaching thousands of
  routines (167 to 228 ms on 1M routines, measured above), on every list
  read. It belongs to the access repository; this change only repeats it
  in the races described.

- Main replaces the whole configuration on every configuration save,
  including autosave, without a client revision precondition. Main's approval saves
  from the cache without a fresh read, then turns the routine on. This branch
  catches changes visible to its fresh GET. A write between that GET and the
  PUT can still be overwritten. A follow-up needs a conditional update based
  on `configuration_revision` for every save path. The scheduler already
  uses the revision to guard its own read-to-write window.
- The scheduler checks for claims acquired after the last cached response or
  notification, so **Keep as my routine** pressed after a run starts but
  before its notification arrives gets the scheduler's refusal, with its
  reason.
- Row **Run now** without the parent in the list leaves definition and
  input validation to the scheduler. A parent the list holds out of date
  can hide **Run now** on a copy's row until the list refreshes; the copy's
  page reads its parent fresh.
- Approval's revision check can't see a scheduler rewrite that keeps the
  revision, nor a write between its last check and the PUT; the conditional
  update above closes both.
- The customer guides (`apps/docs`) for Routines and Agents describe
  sharing and duplication without the copy and definition rules; they
  change when `enable-sub-routines` rolls out.
- The copy page's parent hold, like main's detail hold, follows the
  query's loading state, so a read paused while offline lets the view
  settle before that read fails.
- Keep and Duplicate use the combined native and Pipedream connection set.
  Overlay mappings can differ from the scheduler's Pipedream checks. The
  scheduler validates retained targets and apps, including Duplicate's own
  task apps, and its refusal message appears in the toast.
- New and autosave preserve main's behavior while connection data is
  unresolved. If the scheduler rejects the save, New retains the draft and
  autosave retains the edit for retry. New, manual Run and ordinary
  activation keep main's tracing. Autosave still has a standalone span from
  debounce admission because it can combine edits across several inputs.
- Metadata writes and Duplicate can echo the saved task. The scheduler omits
  empty `mcp_servers` in its stored task and requires the key when the
  previous definition had apps. The explicit empty key applies to rebuilt
  definitions.
- With `enable-event-routines` off, main still offers turning on an event
  routine, autosaving its edits and creating a restored draft with an event
  trigger; the scheduler refuses each, as it does on main. This branch gates
  the menu actions it adds, and main's Duplicate and approval.
- A definition's validation message is translated around its reason, but
  the reason itself (such as an empty step list) still comes from the
  shared step validation's English text, as on main for a routine's own
  steps.
- **Add step** offers Ask AI inside definitions and on programs with stored
  input values. AI step writing requires the drafter to accept typed inputs
  and validate generated steps in that input context.
- Direct duplication of a scheduled copy would require a scheduler operation
  to resolve and validate a standalone snapshot. Keep followed by Duplicate
  uses the standalone create rules.
- List tests cover the WebSocket handler and real query caches with mocked
  service responses. Trace tests cover asynchronous interaction lifetime
  and parent handoffs locally. No test measures layout at phone width, and
  exported traces were not checked against a collector.
