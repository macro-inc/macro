# Editing overlay hosts

Contract review base: `f6b274089f940f4b4f790e05d755a78ed39e59a8`.
This describes the migration boundary; it does not assert native acceptance.

Keep each existing Solid component and its controller. Source adapters retain
command ordering, priorities, transactions, DOM anchors and selection timing.
Native adapters use the actual SessionPort, published mirror and native actions;
they never construct Lexical editors or nodes or obtain a Source context.

## Admission and lifetime

UI editability comes from the surface's reactive permission. Session admission is
independent: every write uses the current effective Session access. Captured
bookmarks or asynchronous lookup results never confer permission. Include the
actual key generation and actual selection in EditorApplication. Preserve explicit
node/table selections when admitting a DOM range. The existing native envelope
checks generation and current Session admission. Controllers must validate their
own captured target, revision and invocation facts; the envelope does not provide
general bookmark validation. Pin each controller's Source staleness semantics
before adding a rejection rule.

The additive `installOverlays(view)` installs host listeners once and returns an
explicitly disposed `runtime.overlays` installation. Keep the existing optional
`runtime.editing` capabilities for notebook and comment consumers. Components
mount under the captured Solid owner and the
existing app providers. Dispose listeners and pending uploads before closing the
session. Do not fabricate unused toolbar/comment methods to satisfy the existing,
currently unimplemented `NativeMarkdownEditingPort` interface.

The native document installation owns the actual checklist bridge and
`group-b.focus-end` action. Its shared exterior-focus host retains the existing
focused-range guard. Browser focus runs in actual SessionPort completion,
rechecking the installation lifetime, mounted view and UI editability. Missing
menu renderers remain absent; this installation does not declare all editing UI
ready.

Published mirror reads supply DOM identity, geometry and published reactive UI
facts such as selected-node state. Reads during an
ordered native command scope must use that scope's explicit native read API.
Ordinary `registerViewCommand` priority ties remain invalid; consume the separately
owned ordered Normal Enter facade when a controller needs that priority.

## Source dependency inventory and native capabilities

All component paths below are relative to
`apps/web/src/lib/core/component/LexicalMarkdown/`.

| Overlay | Actual Source reads/calls | Narrow host capability | Native status at review base |
| --- | --- | --- | --- |
| Slash (`component/menu/ActionsMenu.tsx`) | Root listener/root, `hasNodes`, CLOSE/REMOVE action search, `Action.action(editor, context)`, existing menu operations; dependency check differs between click and keyboard selection | Root subscription, action availability, close query, remove query, execute selected catalog action with pointer/keyboard origin | `group-a.menu-select` atomically validates/replaces exact UTF-16 trigger range and inserts block choices. No general menu query/close primitive. Picker and creation actions require typed choices; filtering to nine block actions would lose Source rows. |
| Checklist (`plugins/checklist/checklistPlugin.ts`) | Owned listitem DOM, editable gate, checkbox hit geometry, drag threshold, toggle-selection keyboard routing | Register owned pointer bridge and dispatch toggle by key | `registerNativeChecklist` already exists but is unmounted. `group-b.checklist` supports toggle, toggle-selection, settings with attached/type/generation checks. Native task-list controls are separate from toggling. |
| Link (`component/menu/FloatingLinkMenu.tsx`) | `isEditable`, `isInteractable`, root/focus; `linksPlugin` hover/click/create callbacks; insert/update/url/unlink commands; HIGH Escape and CRITICAL Enter handlers | `LinkMenuHost` below | Existing `registerNativeLinks` supplies hover/click and `group-b.link` supplies insert/update/url/toggle/unlink. Create-picker notification and captured-link selection targeting need explicit native wiring. |
| Mentions and inline search (`component/menu/MentionsMenu`, `EmojiMenu.tsx`, `SnippetsMenu.tsx`) | Inline-search mutation/query state, live range/peer validation, catalog/service providers, typed mention payloads, collapse/remove and insertion commands | Current query identity/range and catalog types, close/collapse, atomic native choice commit | `group-a.menu-select` supports text, user, document, date, group, agent-session, booking-link, block, snippet and snippet-start. No general web menu-query API. Existing Android source providers retain their own lifetime protocol and are not a replacement web UI. |
| Drag blocks (`component/misc/DraggableBlockMenu.tsx`, `DragInsertIndicator.tsx`) | Root rect, nearest node, list parent/first-child/group, selected text, drag store, copy/delete/move actions | Owned block target/group query, reactive drag state, DOM rects and native move/copy/delete | Native draggable-block registration and geometry exist. Shared menu must stop reading Lexical list nodes; selection-only commits must not invalidate document-revision drag validity. |
| Table picker (`component/menu/FloatingTableMenu.tsx`) | Picker plugin callback and insert command, root/selection positioning, editable gate | `TablePickerHost`: root/focus, insert dimensions, register picker | `group-b.table` picker/insert and `registerNativeTablePicker` exist. Source extraction retains the original shared controller; native binding is separate. |
| Table insert/delete (`component/misc/TableInsertButton.tsx`, `TableDeleteButtons.tsx`) | DOM cell lookup, table map, selection extent, scroll clipping, hover target, row/column insertion/deletion | Native cell identity, table/selection extents plus DOM measurements, insert/delete | Native insert-row/column, delete and convertible-list query exist. Native extent projection must be verified before replacing Source map reads. |
| Table action/selection/move (`component/misc/TableSelectionActionBar.tsx`, `TableMoveHandle.tsx`) | Live table/range selection, table map, merge state, insert/delete/unmerge/move, touch long press and focus | Typed selected-cell extent/capabilities, native actions, root/geometry subscriptions | Native table selection and move-cells exist. Audit merge/unmerge and action availability individually; no speculative supported-action list. |
| Table resize (`component/misc/TableCellResizer.tsx`) | Captured column/row resize snapshot, zoom, measurements, pointer capture, apply/revert, Escape and editable loss | Capture/apply/restore typed resize snapshot; DOM-only measurements and pointer lifecycle | `createNativeTableResizer`, table-resize query and resize/restore actions exist; wire them into the same controller and verify cancellation/history. |
| GIF (`component/menu/FloatingGifMenu.tsx`) | Picker callback; cloned selection, skip-DOM-selection tag; root/update listener; async upload, selection restore, attached checks and insertion | `GifMenuHost<Target, Insertion>`: picker registration, captured target, prepared insertion, dirty subscription, identity checks and actual commit result | Source host preserves the real controller. Native still needs an exact GIF payload, captured target and asynchronous completion contract; no native GIF host is mounted. |
| Exterior focus (`component/core/FocusClickTarget.tsx`) | Active range, focused state, last child's paragraph/empty status; append paragraph then select end in one update and focus | `hasSelection`, `editable`, atomic `focusAtEnd` | The additive overlay installation calls real `group-b.focus-end`, then browser focus after actual completion with lifetime/editability rechecks. Local policy, Machine and shared-component browser controls pass; installed document-app acceptance remains separate. |

## Integrated checklist and exterior focus

The native document installs only the checklist pointer bridge and exterior
focus through `installNativeMarkdownOverlays`. No renderer or menu is returned.
`runtime.editing` stays independent, and unavailable capabilities remain absent.

The focused regression is
`apps/web/src/lib/core/component/LexicalMarkdown/editing/browser-test`.
It covers desktop/touch checkbox gestures, read-only and queued Session access,
listener disposal/remount, and exterior focus after actual native completion.
The metadata roundtrip control separately compares the real Source parser;
these tests do not establish full document-app or native menu acceptance.

## Link menu host

```ts
interface LinkMenuCallbacks {
  hover(info?: ILinkInfo): void;
  click(info?: ILinkInfo): void;
  create(info?: ILinkInfo): void;
}

interface LinkMenuHost {
  isEditable(): boolean;
  isInteractable(): boolean;
  root(): HTMLElement | null;
  focus(): void;
  registerMenu(
    callbacks: LinkMenuCallbacks,
    autoLinkMatchMode?: AutoLinkMatchMode
  ): void;
  registerKeys(callbacks: {
    escape(): boolean;
    enter(): boolean;
  }): () => void;
  insert(url: string, label: string): void;
  update(url: string, label: string): void;
  updateUrl(url: string | null): void;
  unlink(): void;
}
```

Source wrapper resolves its real context and constructs this host. The shared
component requires the host, with no Source-context fallback. Source
`registerMenu` retains `plugins.use(linksPlugin(...))`; `registerKeys` retains
HIGH Escape and CRITICAL Enter and merge-register cleanup. Plugin registration
belongs to the host lifetime: Source's PluginManager owns its actual cleanup;
the native host must retain and dispose its native listeners. `insert` and `update`
map `label` to Source `linkText` without changing command boundaries.

Native host uses existing typed link adapters and real Session selection. It
must capture the clicked link's model target before the form steals focus, and
must not mutate whichever unrelated range happens to be current on submit.
Create-picker opening is an explicit host request, not a synthetic Lexical
command. Native registration must prove command priority and disposal parity.

Proposed first hunks: new `editing/overlay-hosts/link.ts` contract;
new `editing/overlay-hosts/lexical-link.ts` Source adapter;
`component/menu/FloatingLinkMenu.tsx` wrapper plus shared host-driven component.
No changes to decorator native factories, full registry, EditorView, SessionPort,
Normal Enter or executor construction are needed for that extraction.

## Source slash decision trace

`shared/registerInlineMenuTrigger.ts` registers root keydown/keyup and captured
beforeinput. A matching keydown invokes the trigger once and remembers it, with
no composition/default-prevention test. The beforeinput fallback invokes only
for `insertText` with the exact symbol, no already-handled keydown, no composition
and no default prevention. Keyup, beforeinput and root replacement reset the
deduplication flag. These are distinct paths, including Android Unidentified
keydown behavior.

`actionsPlugin` invokes `validTriggerPosition` before inserting an actual
InlineSearchNode. That function reads the committed RangeSelection anchor; it
does not require a collapsed range or check composition. It rejects an existing
InlineSearchNode anchor and code ancestry. Before-text must be empty or end in
whitespace and must not end in a backtick. After-text must be empty or begin with
whitespace for slash, emoji and snippets. Mentions pass `after=null`, allowing a
word after the trigger. Text offsets are UTF-16. An element anchor joins its
children before/after its child offset; text offset zero also checks the previous
text sibling, preserving formatted word boundaries.

The slash trigger inserts an InlineSearchNode containing `/` at the actual
selection. Its transform collapses a leading `//` to `/` and selects its end.
The peer-valid mutation listener opens only when a newly created node's text is
exactly `/`; updates remove U+200B, trim and remove one leading trigger before
publishing the search term. Destroy closes the menu. This is model lifecycle,
not a DOM regex or a newly inferred native eligibility rule.

CLOSE dispatches `$collapseInlineSearch`: replace every peer-valid search node
with a new ordinary TextNode containing its literal text. REMOVE dispatches
`$removeInlineSearch`: remove every peer-valid search node. Both traverse the
whole editor, rather than only the selected slash node. They differ in JSON,
selection and text format ownership; do not implement CLOSE as REMOVE plus
retyping or preserve search-node formatting speculatively.

Executed `action-search-contract.test.ts` controls cover empty/whitespace/word,
backtick/code exclusions and an astral prefix at UTF-16 offset 3. For the actual
`/🐺term` search, CLOSE produces ordinary text `/🐺term` with collapsed text
caret offset 7; REMOVE produces an empty paragraph with collapsed element caret
offset 0. Both remove the search node and close the menu. These controls are
Source evidence. Existing native menu-select validation separately requires an
attached exact range, no composition/code and a collapsed caret at its end;
it does not establish a native query API.

## Source catalog action and I/O boundaries

`ActionMenu` retains the actual merged catalog, database availability gate,
dependency filter and fuzzy ranking. Pointer selection removes search first,
then rechecks dependencies before calling the selected action. Keyboard selection
also removes search first, but calls the selected action without that second
dependency check. Empty results still remove the search on Enter. Escape, focus
loss, outside press and the existing space-state controller collapse the search.
Do not change these transactions while extracting a host.

| Catalog choice | Source action after removing search | Boundary that native still needs |
| --- | --- | --- |
| paragraph/headings/quote/code/lists | Actual shared block-transform commands | Existing native block choice; preserve node availability and configuration. |
| image/video | Microtask dispatch of TRY_INSERT_MEDIA_UPLOAD with `all` | Host file dialog/upload request and actual media insertion. Both choices currently use `all`; do not narrow one by its row label. |
| GIF | Microtask dispatch of TRY_INSERT_GIF | Real picker request; upload completion targets the captured insertion range, revalidates current editability and cleans unused uploads. |
| link | Microtask dispatch of TRY_INSERT_LINK | Actual create callback and retained model selection before URL-input focus. Link browser controls execute this boundary. |
| equation | Microtask dispatch of TRY_INSERT_EQUATION | Actual equation menu request and native insert; preserve the existing Source Enter behavior rather than silently repairing it. |
| table | Microtask TRY_INSERT_TABLE_PICKER; if unhandled, INSERT_TABLE with rows/columns `3` and headers `false` | Typed picker request with handled result and actual native insertion policy. The fallback belongs to the existing Source action, not a fallback to Source from native. |
| divider | Synchronous INSERT_HORIZONTAL_RULE | Native insertion action with Source selection/history semantics. |
| task/document | Opens the actual creation composer; start inserts Await, failure removes it, success replaces it or inserts a mention | Host service/popover request with owned await identity, mention tracking and native completion. No service request occurs merely by showing the row. |
| database query | Feature gate, then microtask update inserting an empty scalar DatabaseQuery | Native node insertion with the same gate/configuration. |
| database | Feature gate, microtask inserts Await before lazy module download and creation | Host service workflow and native placeholder completion/cancellation. |

`slash-picker-contract.test.ts` executes the real catalog's deferred media,
GIF, link and equation requests after search removal, the handled table picker
and actual 3-by-3 no-header fallback, and synchronous divider insertion.
`slash-creation-contract.test.ts` executes task/document opening and the actual
Await/mention model transitions for start, failure and completion, with only the
popover host boundary supplied. These do not prove file dialogs, remote service
creation, or native request execution. Database catalog-entry requests still need
their own executed Source controls before freezing native request contracts.

## Acceptance

Before each Source extraction, capture the real component/controller DOM and raw
JSON in Chromium, Firefox and WebKit; compare exact before/after captures. Then
run the same area through the actual native app mount and make its previously red
cases green. Include pointer/keyboard, desktop/touch, dynamic read-only, stale
async answers, selection restoration and disposal. A leaf fixture or model unit
test alone cannot close app acceptance. Report exact per-area counts and keep
failed/blocked evidence, including pre-existing Source defects.

## Table picker Source host

`FloatingTableMenu` resolves the original `canEdit` fallback and real Source
context, then supplies `HostedFloatingTableMenu` with `TablePickerHost`.
The shared controller retains `createCallback`, deferred timer opening, keyboard
capture, grid markup, positioning, insertion reset and focus on cancellation.
It does not add focus after insertion. The Source adapter alone dispatches
`INSERT_TABLE_COMMAND` with string dimensions and `includeHeaders: false`.

`registerPicker` returns void because the actual Source PluginManager owns the
`useReactive` registration and its command cleanup. The effect still reads the
current manager dynamically and registers under the same component owner; no
synthetic cleanup is supplied. A future native host must own the real cleanup
returned by `registerNativeTablePicker` and dispose it exactly once with its
installation. Native table action, selection, move, resize and touch menus are
separate work and are not established by this extraction.

## GIF Source host

`FloatingGifMenu` retains the original permissions fallback and Source context,
then supplies the required `HostedFloatingGifMenu` host. Generic target and
insertion values belong to the real adapter; the shared UI never fabricates an
editor, node or selection. The actual picker callback captures selection before
search takes focus, and the Source adapter retains the skip-DOM-selection tag.

`prepareInsertion` reads the current editor, checks UI/editor editability, clones
the saved selection and captures the root before request/signals are created.
The shared controller subscribes to actual dirty-element/leaf changes only after
setting the upload error signal, preserving its abort and finally cleanup order.
After upload it checks request lifetime, menu state and UI editability; the
adapter then checks editor editability and exact editor/root identity in the
original order. Its discrete commit rejects detached captured range endpoints,
restores the selection or selects root end only when no current selection exists,
and inserts the real GIF image. There is no general revision rejection.

Source commit returns the actual synchronous insertion result. A future native
host must obtain actual completion and cannot treat queued `undefined` as failed
admission and discard an in-flight upload. Native picker requests, authoritative
bookmarks/current generation and completion remain unimplemented here.
The adapter also observes successful insertion at the original in-transaction
checkpoint. This keeps the shared upload marker true if a later Source update
listener throws after model commit, so cleanup does not discard a referenced
file. The opaque exception and finally ordering remain unchanged.

The host's actual PluginManager retains reactive picker registration cleanup.
Panel registration runs under the panel owner and registers upload cancellation
before the actual editor-root focusout listener cleanup, preserving the original
portalled-composer behavior. Upload IO, error/retry/search/grid state, orphan-file
discard and all markup remain in the shared controller. Existing controller
unit tests supply upload results and observe insertion; the separate GIF plugin
unit test exercises real image serialization. Browser cases supply catalog and
failed downloads only and do not establish successful uploads or native binding.
