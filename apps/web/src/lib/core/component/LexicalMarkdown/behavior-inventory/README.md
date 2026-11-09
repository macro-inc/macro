# Editor behavior regression ledger

These tests exercise production Lexical APIs and Macro plugins through their
normal imports. They cover title normalization, insertion and placeholders,
list deletion, indentation, clipboard precedence and quoted paste, focus
boundaries, equation/table picker commands, menu navigation, Android input
triggers, emoji/tag lifecycle, checklist input, word counts, location restoration,
metadata/accessories, platform formatting, decorator navigation, list transform
boundaries and mention insertion/deletion/history. Direct transformer calls
cover import/typing modes; direct mention commands do not establish menu UI
coverage. Remote-label history tests establish grouping, not preservation of
remote labels through undo/redo.

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

`scripts/editor-behavior-map.ts` and `editor-existing-behavior-map.ts` map
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
read-only, save/reopen, undo and production slash-menu interactions. The menu
uses the real analytics/flag providers, editor theme and Macro stylesheet, with service-backed
actions excluded from this isolated fixture. Its filtering, wrapping keyboard
navigation, insertion, dismissal and pointer/touch focus behavior are exercised.
Checklist tests target the measured pseudo-element, verify its actual hit target,
and translate layout coordinates into the visual viewport for native touch.
The fixture uses padding rather than outer body margins to avoid overflowing
the phone viewport. File paste/drop tests stop at the host callback boundary.
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
