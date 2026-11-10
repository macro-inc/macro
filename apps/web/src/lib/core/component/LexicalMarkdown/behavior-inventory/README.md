# Editor behavior regression ledger

These tests exercise production Lexical APIs and Macro plugins through their
normal imports. They cover title normalization, insertion and placeholders,
list deletion, indentation, clipboard precedence and quoted paste, focus
boundaries, equation/table picker commands, menu navigation, Android input
triggers, emoji/tag lifecycle, checklist input, word counts, location restoration,
metadata/accessories, platform formatting, decorator navigation, list transform
boundaries, mention insertion/deletion/history and media mutation/permission
guards and checkbox-to-task conversion. Task creation is a service boundary stub;
its tests exercise actual selection/parsing, parallel completion, batched node
replacement, partial failures and deleted targets, not remote task creation
or host authorization. Checklist collector/planner mappings
cover actual node metadata and supplied task facts. Real-node collection cases
pin root checklist boundaries, nested wrapper ownership, assignee deduplication,
first-date/task precedence and metadata removal after committed edits. The current planner dims
filtered rows and counts progress; row grouping/collapse is not implemented.
Its legacy hideFiltered setting is ignored rather than hiding rows. Planning
cases pin calendar-day due boundaries, marker priority, task-data precedence,
filter OR/AND semantics, completion counts and wrapper-row order. DOM cases
apply and clear dimming on real mounted rows without changing saved state,
including stale plans after deletion. Unit task facts are supplied; those cases
do not establish dropdown UI, real task queries or native hosting. TaskList DOM cases use the mounted jsdom host to check
unmanaged toolbar identity through committed child edits, HTML export and
removal, list-kind DOM replacement and ordered-start updates that preserve
managed item identity. These exercise the inherited ListNode DOM hooks in the
mounted TaskList subclass. Their toolbar sentinel is host-owned test content, not the real
controls UI. Legacy list cases explicitly dirty an imported node and run the
production controls transform; bare JSON parsing does not apply factory
replacements. Native/custom-class hosting remains unverified. HEIC conversion and transport are boundary stubs in media unit cases;
these do not establish actual decoding or uploads. Direct transformer calls
cover import/typing modes; direct mention commands do not establish menu UI
coverage. Remote-label history tests establish grouping, not preservation of
remote labels through undo/redo.

Caret-scroll cases use actual model selection and the production caret utility,
with supplied jsdom geometry, viewport facts and fake timers. They pin safe-zone
arithmetic, missing selection and hidden-keyboard edits. Existing iOS Backspace
mappings supply the platform constant and observe keydown cancellation/text;
they do not establish glide deletion, native keyboard delivery or animation.

Blame-hover cases use the production controller/store, mounted nodes and stable
IDs, and native DOM selection. They cover nearest-ID lookup, touch/selection
suppression, dismissal events, root replacement and listener disposal. The
pointing-device boundary is supplied; tooltip rendering and remote attribution
data remain unverified.

Selection-popup cases use real model/native selections, table nodes and the
production Markdown parser. Geometry and touch capability are supplied. They
pin eligibility, host acceptance, full-block Markdown context/replacement,
delete yielding, highlights and disposal. Geometry assertions compare explicit
coordinates: after native selection clears, recomputation falls back to the
original cached rectangle. These do not establish rendered popup UI, AI
requests or a native table action bar.

Focus-guard cases keep editor.focus and native DOM selection/focus real. A
host-owned button in the actual TaskList unmanaged mount verifies embedded
focus ownership; it is not the production controls renderer. Synthetic pointer
and cancelable focus events, fake timers, supplied pointerType and jsdom range
geometry pin mouse/pen and 500 ms touch boundaries, root replacement and
disposal. They do not establish physical event ordering or native focus timing.

From this worktree's `apps/web`, with its own dependencies:

```sh
bun run test --project core \
  src/lib/core/component/LexicalMarkdown/behavior-inventory --maxWorkers=2
```

If session WASM is absent, first run
`CARGO_BUILD_JOBS=2 just -f apps/web/justfile build-document-session-wasm` from the
repository root, using the pinned Rust toolchain and matching wasm-bindgen CLI.
This builds the artifact in this checkout and regenerates its declarations.
Keep the resulting artifact stable while Vitest reads it. Full web tests run
with `VITE_ENABLE_RUST_EDITOR_MODEL=false bun run test --maxWorkers=2`.

The tests supply platform and clipboard boundaries where jsdom lacks them;
they do not mock the editor core. Assertions compare actual node structure,
text, formatting, selection, command handling, DOM and lifecycle callbacks.
Fake timers drive the production word-count debounce and Enter cleanup without
sleeping. The Enter cases use the full production node registry and record that
format and style remain inherited after a formatted paragraph; the existing
bare-node cleanup test has different behavior; the cause is not established. This is an observed OFF contract,
not evidence that the cleanup intent is satisfied.

## Source inventory

```sh
bun scripts/editor-behavior-inventory.ts /tmp/editor-behavior-source
```

Optional trailing arguments are OFF Vitest JSON reports from separate runs:

```sh
bun scripts/editor-behavior-inventory.ts /tmp/editor-behavior-source /tmp/editor-results.json
```

`scripts/editor-behavior-map.ts`, `editor-existing-behavior-map.ts`,
`editor-async-behavior-map.ts`, `editor-node-behavior-map.ts` and
`editor-menu-behavior-map.ts`, `editor-checklist-behavior-map.ts` and
`editor-platform-behavior-map.ts` and `editor-hover-behavior-map.ts` map
concrete reviewed cases to unique source anchors and exact test file/name
selectors. `behaviors.md` reports each mapping separately from the source-site
superset. A unique passing result in the supplied report earns OFF pass;
missing, duplicate, skipped and pending selectors stay unverified. Overlapping
reports remain ambiguous; later results never overwrite earlier results. Failed
selectors stay failed. Each supplied report path and content hash is preserved in the manifest;
multiple reports are composite evidence, not a single full-suite execution.

The scanner emits `source-ledger.json` with content hashes and tables for
plugins, commands, transforms, events, guards, accessibility and surface mounts.
Reviewed plugin summaries live in `scripts/editor-plugin-behaviors.ts`.
Source locations include callbacks registered through shared helpers; a dynamic
command identifier remains dynamic in the table. A helper registering several
commands is one registration site, not one command or one user behavior.

This is a conservative source-site superset. It includes host logic that needs
manual triage, and multiple sites can describe one behavior. Direct-import test
links are navigation aids, not proof that a test covers a particular branch.
Transitive/barrel imports, dynamically registered commands and UI assertions
need manual review. The private custom-caret and element-event prototypes are
explicitly inactive. Neither the source-site count nor plugin-summary count is
a completed, deduplicated behavioral inventory.

Reviewed existing comment mappings distinguish legacy draft wrappers from modern
cursor-based ephemeral anchors. Their assertions cover filtering/reconciliation,
mark removal, publication identity/cancellation and deferred navigation. Service,
publication, flush and layout boundaries are supplied; they do not prove remote
delivery, visible thread UI or native draft handoff. Agent slash mappings
cover the real root keydown trigger, argument-space plain-text insertion and
search removal; they do not establish subsequent skill/PR insertion, rendered
skills UI or delivery to an agent. Private node-map injection
and scroll-only focus-named tests are excluded. Mention search mappings likewise
cover supplied query/cache snapshots, ranking, pagination forwarding and stable
controller allocation, rather than remote search or service-backed menu UI. Cleanup
queue cases use in-memory WAL/removal results. Margin layout uses supplied
geometry/observers and outside-press cases mock Thread content. Pasteboard
cases supply IPC/platform responses and file metadata; they do not execute
native staging/uploads or establish the exact file-size threshold. Closed tag
and snippet tests pin host loading/lazy reads with supplied queries/components;
the snippet editor is a stub, so those mappings do not establish insertion.

## Static browser fixture

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/absolute/path/to/chromium \
bunx playwright test --config \
  src/lib/core/component/LexicalMarkdown/behavior-inventory/browser-test/playwright.config.ts
```

The fixture builds and serves its own static bundle, owns its headless Chromium,
uses one worker without retries, and blocks nonlocal HTTP/WebSocket traffic.
`EDITOR_BEHAVIOR_PORT`, `EDITOR_BEHAVIOR_OUTPUT` and `EDITOR_BEHAVIOR_JSON` select
its port and evidence destinations. Defaults use the OS temporary directory.
Desktop, tablet touch and phone touch run the same paste, formatting,
read-only, save/reopen, undo and production slash/emoji-menu interactions.
Emoji filtering, wrapped keyboard navigation, shortcode resolution, Escape,
empty results, Space dismissal and pointer/touch insertion use the real catalog. The menu
uses the real analytics/flag providers, editor theme and Macro stylesheet, with service-backed
actions excluded from this isolated fixture. Its filtering, wrapping keyboard
navigation, insertion, dismissal and pointer/touch focus behavior are exercised.
Image cases mount the actual MarkdownImage through DecoratorRenderer and its
editor context. Native mouse/touch drags exercise both resize handles, minimum
size, saved scale restoration, read-only controls, selection/deletion/undo and
the full-screen viewer. Images use a local data URL; this does not test uploads,
remote fetches or production toolbar accessibility. Save/reopen deliberately
replaces the resized node with a fresh scale-1 fixture before restoration.
Code cases mount the actual code plugin, accessory store and renderer. They
exercise language selection with pointer/touch and Home/arrows/Enter/Escape,
saved language restoration, native clipboard replacement, deletion/focus/undo,
and controls mounted initially read-only. Clipboard cases seed a distinct value
before copying. This does not establish virtual-keyboard, live permission
transition or production icon-button accessibility behavior.
Table picker cases use the actual slash action, floating picker and table
plugin. They cover deferred confirmation, default filled-table restoration,
keyboard size limits/grid growth, native pointer/touch dimensions and
Escape/typing/outside dismissal. The fixture owns an explicit scroll area so
large tables leave its operator buttons reachable under the app stylesheet's
clipped document root. The isolated floating group does not establish menu
coordination, grid accessibility, native virtual keyboards or table resize UI.
Link cases mount FloatingLinkMenu and its real link plugin. They check slash
creation, URL/label editing, explicit unlink, Escape, clipboard replacement,
read-only reset and pointer hover. Markdown export asserts Macro's m-link form;
reopening restores JSON, not Markdown. Keyboard activation of Read only avoids
outside-pointer dismissal masking the editability reset. Remote unfurl traffic
is blocked, so hover uses the real fallback card rather than service metadata.
Icon-action order does not establish toolbar accessibility. Shared hooks retain
network isolation, page-error checks and diagnostic captures for every spec.
The separate `link-clipboard.browser.e2e.ts` control uses trusted textarea
Copy/Paste around the real link Copy action. It observes the actual asynchronous
clipboard write completion and restores the method, without supplying clipboard
data. This keeps portable clipboard proof separate from the original test's
browser-specific permission grants. `overlay-capture.browser.e2e.ts` attaches raw
editor JSON and DOM at five slash/link stages; set `OVERLAY_CAPTURE` to also
write per-project files for an exact before/after host comparison. Neither
control establishes native binding or full document-app acceptance.
`table-picker-capture.browser.e2e.ts` similarly attaches raw JSON and DOM at
open, resized and inserted stages. Set `OVERLAY_TABLE_CAPTURE` to retain the
same per-project files. Run it alongside the six existing table-picker cases
when comparing the shared `TablePickerHost` extraction; native binding remains
a separate acceptance gate.
The opt-in `/?gifs` route mounts the real `FloatingGifMenu`. Its copied seven
inventory cases supply catalog and failed-download responses at the external
IO boundary; they do not prove successful upload or native binding. The added
capture case attaches raw open/search/failed-download/closed JSON and DOM;
`OVERLAY_GIF_CAPTURE` also retains per-project files. Input uses `hasTouch` so
the same cases run in independently named browser projects. Keep these runs
separate from historical inventory reports and their dependency epochs.
The opt-in `/?controls` route mounts the actual checklist collector/store and
TaskListControlsRenderer with production query and user providers. Its cases
exercise plain/task progress, task-only filter availability, status selection
and clearing, AND across dimensions, filter JSON restoration after a fresh
list replacement, and progress updates from native checkbox toggles with a
read-only guard. Task requests remain blocked, so task rows use inline fallback
facts; no service-backed properties are accepted. On touch profiles, filter
selection uses keyboard activation with an explicit focus precondition. A
separate hit-test case records that the current hover-only filter target is
unavailable after a native row tap ends. These cases do not establish a working
native-touch filter flow, filter permission enforcement or task-query behavior.
Checklist tests target the measured pseudo-element, verify its actual hit target,
and translate layout coordinates into the visual viewport for native touch.
The fixture uses padding rather than outer body margins to avoid overflowing
the phone viewport. File paste/drop tests stop at the host callback boundary. Existing upload
reference tests also mock file I/O, hashing and a list-insertion helper; their
mappings cover node lifecycle/reference updates, not real transport, list
insertion or rendered spinners.
Touch profiles in Chromium do not
prove iOS/WebKit or Android virtual-keyboard behavior.

The small hand-mounted host reflects the editor's editable listener into its
DOM. Its labels and ARIA attributes are fixture-owned. Accessibility snapshots
and pixels are diagnostic attachments, not production app accessibility or
pixel-parity acceptance. Save/reopen uses in-memory editor JSON and the real
Markdown exporter; it does not prove production persistence, reload recovery,
comment-only authorization or collaboration.

## Engine acceptance

Current results are flag OFF only. The browser config rejects
`EDITOR_BEHAVIOR_ENGINE=ON` because this checkout does not provide the production
compat initializer/resolver. Changing a flag alone does not switch these tests.

Before claiming paired acceptance, wire the production
`scripts/lexical-engine-switch.ts` resolver and real compat preload into both
Vitest and this static build. Run the same assertions under each engine and
record the actual compat/WASM identities. Never alias the core to a test double,
use the older native view as compat, update expectations only for ON, or report
OFF results as parity. Production saved-state equality and full native
accessibility equality belong to the document parity harness in
`features/block-md/browser-test/parity`; its acceptance gates remain required.

The source ledger, these tests, the existing editor suites and the document
parity scenarios are complementary. Unpinned interactive behaviors still need
sufficient regression tests; none of these artifacts alone closes that gap.

Decorator action cases exercise the actual equation and mention command handlers.
They pin expression-only updates, exact display-name IDs, truthy whitespace,
attached-node traversal, history/selection/scroll tags and legacy missing/null
property lookup. These are model command oracles; component rendering and native
interaction acceptance require the separate browser fixtures.


## Paste correction and history oracle

`paste-correction-history.test.ts` combines the actual rich-text paste handler,
Macro document-metadata corrector and plugin-manager snapshot history, over the
production node registry and replacements. Transform registration finishes before
the user command; a public mutation observer then enables the corrector's real
`mutatedNodes` prerequisite. Native microtask completion fences observe the
actual queued callbacks without replacing them, advancing a fake clock, polling,
or forcing correction commits early.

The source case distinguishes the main plain-text paste from the drained root
metadata/version correction, compares complete JSON, retains caret offset 10,
and restores the original state/selection in one undo and the drained state in
one redo. The observed paste chain has four update notifications and three root
mutations; subsequent notifications carry the history-merge tag. It exercises
the `markdown` snapshot-history branch, not collaborative Loro history or
physical clipboard/keyboard input. Separate mutation controls omit the actual
corrector or substitute the captured main snapshot as completion; both must fail
these unchanged assertions. This is an OFF source oracle, not native/ON or
mega-paste acceptance.

`html-paste-nodes.test.ts` records actual OFF RichText copy-to-HTML and paste
for every configured node type using the production node replacements and theme.
Its snapshots describe the pasted result, including intentional DOM loss;
they do not assert that HTML preserves the original JSON. Clipboard and drag
event constructors are host boundaries. This source cohort does not prove
native import, mounted native rendering, physical clipboard behavior or ON parity.
