# Macro spreadsheet block

A native Macro document with multiple worksheets, a 200 × 26 grid, Excel-style
formulas, keyboard navigation, rectangular selection, formula-aware copying and
fill, resizable columns, added rows, rich cell formatting, Excel workbook
import/export, CSV import/value export, find and replace, range sorting, local
undo/redo, and live collaboration. Existing uploaded `.xlsx` files are not
automatically converted; open **Import and export** at the bottom right of a native
spreadsheet, then choose **Import…**.

The document title sits above a compact formatting ribbon. **Paste special** offers
paste and values-only paste; **View options** toggles gridlines, the formula bar,
and formula display. **Functions** inserts formulas, while **Format and data**
contains sorting, whitespace trimming, fill, and clear actions. **Find and replace**
is a direct ribbon button. The footer's **Import and export** button also contains
Excel and CSV downloads and stays visible beside horizontally scrolling sheet tabs.

## Ownership and integration

The block follows the markdown block's document loading, permissions, sharing,
presence, and collaboration infrastructure. Its implementation uses the current
frontend feature layers:

| Layer | Responsibility |
| --- | --- |
| `definition.ts`, `SpreadsheetBlock.tsx` | Load the native document and compose Macro capabilities. |
| `core/spreadsheet-document.ts`, `core/spreadsheet-schema.ts`, `core/workbook-document.ts` | Cell vocabulary, layout, address bounds, stable sheet identities, Loro schema, and document validation. |
| `core/calculation.ts` | Derive cell results from source text with IronCalc. |
| `core/grid-selection.ts`, `core/cell-copy.ts` | Rectangular selection, clipboard validation, and fill planning. |
| `workers/calculation.worker.ts` | Isolated IronCalc evaluation and reference translation. |
| `core/formula-completion.ts`, `core/formula-functions.json` | Function suggestions and signature/argument help from IronCalc's completion context. |
| `context/spreadsheet-source.ts` | Narrow document, connection, and presence source contract. |
| `queries/spreadsheet-session.ts` | Connect the shared collaboration engine, snapshots, WAL, and transport. |
| `primitives/` | Reactive document state, local history, and grid interaction. |
| `components/` | Presentational grid, formula bar, and toolbar. |
| `views/SpreadsheetEditor.tsx` | Compose the editor and load the calculation engine. |

The editor fills its split beneath the shared document title bar. Saved documents
use `ShareTrigger` and `ShareBlockModal`, including existing document permissions,
copy links, and the Share keyboard shortcut. The local sample also has a Share
action: it creates a native document, saves the sample's Loro operations, waits for
the sync acknowledgement, then opens the saved document's sharing dialog. Failed
saves leave the draft editable. Retrying reuses the document and operation IDs so
row additions are not duplicated after a lost acknowledgement.

## Ask Macro and spreadsheet tools

Ask Macro uses the shared chat creation flow and opens an adjacent chat with one
document mention plus a trailing space. The mention includes the active sheet
ID/name and selection snapshot. Local demos save through the existing acknowledged
draft path first. Selection remains local presence, not persisted workbook data.

The editor and AI editing worker import the same pure model and pinned IronCalc
adapter from `@macro-inc/spreadsheet`; the feature's core files re-export that
implementation. Three document tools expose bounded reads, scratch calculations,
and revision-guarded edit batches. Source inputs, formulas, typed results, errors,
and optional styles are explicit in reads. Scratch what-if overrides never write.
The edit vocabulary includes values/formulas, range styles/clear/fill, append rows,
column widths, and sheet lifecycle. Whole-workbook creation still uses the normal
native document creation flow.

Rust tool adapters obtain typed View/Edit receipts, then pass them to the document
domain service. That service verifies the native file type and issues a scoped
short-lived document token. Its editing-worker port calls `/spreadsheet`. The
worker reads a consistent Loro snapshot/revision, prepares and validates edits on
an isolated copy, and sends a compare-and-set delta to sync. Sync validates exact
document access, rejects stale revisions, validates the merged schema, persists,
and broadcasts through the existing collaboration channel. No calculation results
or arbitrary executable code enter the shared document.

Limits are 500 cells / about 100 KB per read, 20 scratch formulas, 25 operations /
2,000 affected cells per edit, a 1 MiB request, and a 4 MiB native snapshot/update limit. Truncated reads explicitly ask
for narrower ranges. Scratch `INDIRECT` is rejected because its text-built references
cannot be safely rebased into the private calculation sheets. The existing disabled
volatile functions and sheet-reference lifecycle guards also apply. Worker requests
have a 30-second deadline and the Rust client a 45-second network timeout; synchronous
WASM is subject to the platform CPU limit rather than a preemptive JavaScript timer.

Deploy the document/AI tool backend, sync service, AI editing worker, and frontend
together before hosted verification. No new provider key or environment variable is
required: deterministic spreadsheet execution uses the existing worker and sync URLs.

An older backend without the `spreadsheet` file type can silently create an ordinary
file before returning a presigned upload URL. The frontend rejects that unsupported
response, but the generic file can remain in Drive. These entries are not native
workbooks and are not automatically converted by deploying spreadsheet support.

## Collaboration and persistence

User-authored source text, formatting, column widths, and row additions are shared.
New native documents start from a versioned Loro seed
(`spreadsheetMeta.formatVersion = 1`). The document has stable Loro root maps keyed
by A1 address: `spreadsheetValues`, `spreadsheetBold`, `spreadsheetFormats`, and
individual maps for each additional style property. Separate property maps allow a value
edit and a formatting edit to merge independently, including when two peers first
touch an empty cell. `spreadsheetColumnWidths` stores bounded column widths, and
`spreadsheetRowAdditions` stores independent append operations that merge
additively. Undo cannot hide rows containing a collaborator's cells. Concurrent
writes to the same property use Loro's conflict resolution. A cell edit is a whole
value replacement; text inside one cell is not coedited character by character.

One user operation produces one Loro commit. A range paste is validated before
writing and committed as one operation. The `UndoManager` tracks local operations;
receiving remote changes does not add those changes to the local undo stack.
Undo and redo are blocked if a collaborator has since changed a field that the
operation would overwrite, including values, formatting, and layout. The editor
keeps their changes and explains the conflict without consuming the history step.
Read-only permissions and initial hydration gate every write and history action.

The session reuses `LoroManager`, `createSyncEngine`, `BrowserWALStore`,
`WALSyncer`, and `IDBSnapshotStore` from `@macro-inc/collaboration`, as markdown
does, including BroadcastChannel synchronization between local tabs. Cached
snapshots and unsent updates restore local state; remote snapshots
merge into an already-initialized document. Selection presence is ephemeral
awareness data, separate from persisted content. The calculation engine's own
history and synchronization format are not used.

Rows and columns currently have fixed positions. Range sorting copies whole rows
within a selected rectangle and translates their relative formulas through IronCalc.
It validates that the sheet, selection, permission, and editing state have not changed
before committing. Other formulas keep their A1 references; they do not follow moved
records. Structural insertion/deletion still needs stable identities and formula
reference transformation across concurrent operations.

### Workbook sheets

The implicit first sheet has stable ID `sheet1`; existing version-1 documents and
the canonical `static_assets/spreadsheet-golden.1.bin` seed open without migration
or writes. Its cells keep plain `A1` keys. Additional sheets receive UUIDs and use
`<sheet-id>!A1` keys in the same property maps. Column widths and row additions use
the same sheet prefix. `spreadsheetSheetNames`, `spreadsheetSheetOrder`, and
`spreadsheetDeletedSheets` hold names, ordering, and deletion tombstones. Every
sheet keeps independent cells, formatting, and layout. Active tabs and remembered
selections are local; presence includes a sheet ID and shows only on that sheet.

Adding, renaming, duplicating, and deleting sheets participate in local undo.
Duplicate copies raw formulas, styles, and layout at the same coordinates.
Deletion retains the sheet's CRDT data so undo can recover it and concurrent
edits. The last visible sheet cannot be deleted locally; simultaneous deletes
that would otherwise leave no sheets expose a deterministic retained sheet.
An edit or sheet addition preserves that retained sheet in the same commit.
One entry per peer and sheet in `spreadsheetSheetRevivals` keeps a collaborator's
revival visible when another user undoes their own operation. Explicit deletion removes
the revival entries it has observed; reading and hydration never revive sheets.
`spreadsheetSheetRetentions` keeps one identity record per peer and sheet, recorded
with cell/layout edits or direct formula references. If a creator undoes adding
or importing a sheet, another peer's surviving record preserves its original
name, position, and remaining content. Unused creation still disappears on undo.
An explicit deletion clears the observed records and remains authoritative.
The editor permits at most ten sheets per local add/import. Concurrent additions
can exceed that limit: all merged sheets remain available, and further additions
are blocked. Each sheet supports up to 1,000 rows and 26 columns.

Names are unique ignoring case and follow Excel's 31-character naming bounds.
Concurrent name collisions receive deterministic display suffixes, preserving
every sheet's identity and content. Renaming or deleting a sheet with existing
direct formula references is rejected; quoted sheet names and escaped apostrophes
are recognized, while ordinary double-quoted text is ignored. This guard cannot
detect references computed by `INDIRECT`, or references arriving concurrently
with a rename/delete. Concurrent name collisions can also change which sheet a
name-based formula resolves to. Such formulas may require manual repair; fully
concurrent reference rewriting remains future work.
Structural undo and redo preview the inverse on an isolated Loro document and
block it when a surviving formula would lose its referenced sheet name. The
history step remains available, and the editor explains the conflict. Formulas
removed by that same inverse do not block it; peer formula edits are preserved
in the preview. The check emits no operations to the live shared document.

Workbook imports validate all names, cells, and layouts before the first write.
Appending rejects name conflicts instead of silently changing formula targets.
Replacing creates fresh sheet IDs and tombstones the previous sheets in one
undoable commit. The import preview blocks replacement after the current workbook
changes, so collaborators' newly received edits must be reviewed again.

## Calculation

`createCalculation()` runs evaluation and formula copying in separate lazy module
workers, keeping the editor responsive. Each calculation has a three-second
budget; exceeding it terminates the worker. Retry creates a fresh worker. Engine
download/initialization has a separate 15-second timeout. New revisions supersede
pending work, and stale results cannot replace the current revision. Error states
keep source editing and undo available.

Inside the worker, `createSpreadsheetCalculator()` lazily initializes the pinned `@ironcalc/wasm`
engine. Loading failures can be retried. `calculate(cells)` builds a fresh model
from the current sparse cell sources, evaluates the workbook, reads results, and
frees the model. Rebuilding is deliberate for this bounded MVP: edit arrival order
cannot leave stale dependencies, deleted cells, or a second undo history behind.
Calculated values never enter the shared document.

Formula assistance uses a separate lazy worker and IronCalc's own incomplete
formula parser. Keystrokes coalesce while it starts, and stale responses cannot
replace current help. The cell editor and formula bar share the same accessible
listbox, keyboard insertion, and argument hints. The function catalog is adapted
from [IronCalc commit 8fd0a82](https://github.com/ironcalc/IronCalc/blob/8fd0a82a6e36e49f665df21c725cb67806ec24ee/webapp/IronCalc/src/components/FormulaHelper/functions.json),
filtered against the pinned 0.8.4 engine and Macro's disabled volatile functions.
Its MIT notice is in `core/formula-functions.LICENSE`; refresh and verify the
catalog when upgrading the engine.

Formula point selection keeps the original cell and textarea focused while a
pointer drag inserts or replaces an A1 reference at the caret. Only the local
draft and a single dashed reference overlay update during dragging; the shared
document and calculation worker receive the formula on commit. Quoted text and
completed expressions retain normal click-away behavior.

Selection does not recalculate the workbook. A bounded row window mounts visible
rows and a small buffer, keeping the active editor mounted while scrolling. Shared
row offsets account for wrapped text, font size, and zoom. Two overlays
draw the selected range and active cell, while Solid selectors update only
changed cell selection attributes. Footer aggregates run outside urgent pointer
updates, and collaborator presence is limited to ten updates per second with a
trailing update for the final selection.

IronCalc handles formula parsing, ranges, relative and absolute references,
dependency evaluation, functions, circular references, Excel errors, and array
spills. The model uses fixed English settings and UTC on every client. Number
formatting uses fixed `en-US` display rules; currency formatting means USD. The
binding exposes numbers through formatted strings, so the adapter requests a
scientific format with sufficient significant digits before applying UI formats.
Calculations use the engine's numeric values, not rounded UI values.

`NOW`, `TODAY`, `RAND`, `RANDBETWEEN`, and `RANDARRAY` deliberately return `#N/A`
with an explanation. Enabling them requires a shared calculation clock and seed,
otherwise collaborators could see different results for the same document.
Function detection uses IronCalc's tokenizer, so quoted text like `="RAND()"`
continues to work normally.

### Engine choice

| Engine | Decision |
| --- | --- |
| [IronCalc](https://github.com/ironcalc/IronCalc) | Selected. The engine is MIT/Apache-2.0 licensed, implemented in Rust, and published with typed browser WASM bindings. It owns spreadsheet semantics instead of requiring a custom evaluator. |
| [HyperFormula](https://hyperformula.handsontable.com/docs/guide/license-key.html) | Capable alternative with GPLv3 or a purchased proprietary license; not introduced as an unreviewed license obligation. |
| [fast-formula-parser](https://github.com/LesterLyu/fast-formula-parser) | MIT parser/evaluator alternative. Its callback-based formula evaluation would leave more workbook dependency, cycle, and mutation behavior in Macro. |

Primary integration references: [IronCalc JavaScript bindings](https://docs.ironcalc.com/programming/javascript-bindings.html),
[engine-only versus XLSX bindings](https://github.com/ironcalc/IronCalc/blob/main/bindings/wasm/README.md),
and [upstream WASM API](https://github.com/ironcalc/IronCalc/blob/main/bindings/wasm/src/lib.rs).
The npm package is pinned to `0.8.4`; engine upgrades should run the adapter tests
and compare formula, error, and formatting behavior before updating the pin.

## MVP boundaries and next steps

- Each sheet starts with 200 rows and 26 columns; append rows up to 1,000.
  Column widths range from 64–640 pixels, with drag, keyboard resize, and auto-fit.
  Cells accept up to 10,000 characters. Plain-text paste accepts at most 1 MB;
  internal clipboard metadata accepts at most 4 MB. Overflow rejects before writes.
- Array results are shown within the visible grid. There is no grid expansion for
  an array that spills beyond its edges.
- The ribbon exposes font family/size, bold/italic/underline/strikethrough,
  text/fill colors, per-edge borders, horizontal/vertical alignment, and wrapping.
  All cell styles persist, sync independently, copy/fill, and undo. Number formats
  include general, number, USD currency, percent, scientific, date, time, and plain
  text, with adjustable decimal places. Date/time displays are deterministic UTC.
  Plain text treats formula-looking input literally. Wrapped rows grow to 160px at
  100% zoom; larger content remains available in the formula bar/editor.
- Internal copying preserves formatting and translates relative/mixed references
  through IronCalc; absolute references remain fixed. The fill handle repeats a
  source range in one direction; Cmd/Ctrl+D fills from the top row and Cmd/Ctrl+R
  from the left column. Fill repeats values; it does not infer numeric series.
  Plain-text clipboard data and cut preserve raw formulas verbatim.
- Structural insertion/deletion, filters, charts, named ranges,
  automatic spill expansion, and drag auto-scroll remain future work.
- CSV import writes a validated rectangle at the active cell, appending rows when
  needed. It preserves existing cell styles and supports quoted multiline fields.
  CSV exports values and drops formatting. XLSX import/export converts supported
  workbook cells, formulas, styles, and column widths to the native shared model;
  unsupported workbook features produce warnings in the import preview.

## Verification

Run focused tests from `apps/web`:

```sh
bun run test --config src/features/block-spreadsheet/vitest.config.ts
```

Calculation tests initialize the actual WASM engine and cover formulas, precision,
errors, cycles, source ordering, deletion, array spills, and volatile functions.
Controller tests exercise keyboard selection, draft commit/cancel, atomic paste
validation, clipboard round trips, formatting, and read-only behavior. Document
and store tests cover CRDT merging, persistence, and local history. Exercise the
editor in a browser as well; unit tests do not verify focus, scrolling, or the
production transport.

The [browser fixture](browser-test/README.md) runs the composed editor with real
calculation and Excel workers. Its Playwright suite covers formula autocomplete
and range picking, menu/dialog focus, sheet navigation, read-only transitions,
Excel round trips, workbook import undo, and formatting without remounts or flashes.
Its separate mobile suite uses Android Chrome and iPhone WebKit emulation for
touch editing, formula suggestions, selection/reference handles, menus, sheets,
permissions, and compact layouts. Android gestures use trusted touch input;
WebKit handle drags use a mouse pointer, so native iOS gestures and software
keyboard behavior need simulator/device verification. iOS 26.5 Safari on an
iPhone 17 Pro simulator was checked with the real software keyboard: the footer
stayed above it, and touch autocomplete and formula-reference taps retained focus.
Native iOS handle drags/swipes and physical-device behavior remain separate checks.

### Sync worker integration

`services/sync-service/tests/spreadsheet.test.ts` runs the compiled Rust worker
in Miniflare with distinct user tokens and real WebSockets. It covers concurrent
cells/format/layout, conflicting values, offline reconnect, reopening, independent
document copies, edit/view permission transitions on reconnect, and process
restart with persisted storage. It uses isolated temporary data, not hosted files.

From `services/sync-service`, after installing its locked npm dependencies:

```sh
worker-build --profile sync-service-release
node node_modules/vitest/vitest.mjs run tests/spreadsheet.test.ts
```

This proves the sync-service boundary locally. It does not cover hosted creation,
DSS publication/search, or the complete authenticated sharing UI. Those still
require deployment and two real app sessions. The shared sync service authorizes
a WebSocket when it connects; immediate permission revocation of an already-open
connection is not implemented by this spreadsheet feature. Test fresh-token
reconnection separately from that release-blocking security requirement.

## Internal rollout and merge checklist

The `enable-spreadsheets` PostHog flag gates creation menus, keyboard creation,
project creation, native block loading/editor mounting, and the development demo.
PostHog controls it in every environment; there is no development default. The
`VITE_ENABLE_SPREADSHEETS` override uses the app's standard flag mechanism.
Target this flag to the Macro team in PostHog. There is no hard-coded email-domain
restriction: existing document permissions and typed AI access receipts enforce
access to each workbook independently of feature rollout targeting.

Deploy the spreadsheet-enabled document service, sync Worker, AI editing Worker,
and frontend together to dev. The AI Worker deployment watches
`packages/spreadsheet/**`, so shared schema/calculation updates cannot silently
leave its bundle behind. After deploy, verify real staff login, creation, reopening,
sharing with another staff user, two-user edits/cursors, and Ask Macro against a
closed workbook. The isolated local tests cover the production editor/session and
sync Worker, but do not exercise hosted authentication/token refresh or document
publication/search. Keep public rollout disabled until those checks and the
existing live-permission-revocation limitation above are resolved. Keep the PostHog flag targeted to the Macro team for the internal pilot.
