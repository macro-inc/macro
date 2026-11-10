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
| Table picker (`component/menu/FloatingTableMenu.tsx`) | Picker plugin callback and insert command, root/selection positioning, editable gate | Subscribe picker request, insert dimensions/headers, root/focus | `group-b.table` picker/insert and `registerNativeTablePicker` exist. |
| Table insert/delete (`component/misc/TableInsertButton.tsx`, `TableDeleteButtons.tsx`) | DOM cell lookup, table map, selection extent, scroll clipping, hover target, row/column insertion/deletion | Native cell identity, table/selection extents plus DOM measurements, insert/delete | Native insert-row/column, delete and convertible-list query exist. Native extent projection must be verified before replacing Source map reads. |
| Table action/selection/move (`component/misc/TableSelectionActionBar.tsx`, `TableMoveHandle.tsx`) | Live table/range selection, table map, merge state, insert/delete/unmerge/move, touch long press and focus | Typed selected-cell extent/capabilities, native actions, root/geometry subscriptions | Native table selection and move-cells exist. Audit merge/unmerge and action availability individually; no speculative supported-action list. |
| Table resize (`component/misc/TableCellResizer.tsx`) | Captured column/row resize snapshot, zoom, measurements, pointer capture, apply/revert, Escape and editable loss | Capture/apply/restore typed resize snapshot; DOM-only measurements and pointer lifecycle | `createNativeTableResizer`, table-resize query and resize/restore actions exist; wire them into the same controller and verify cancellation/history. |
| GIF (`component/menu/FloatingGifMenu.tsx`) | Picker callback; cloned range, skip-DOM-selection tag; root/update listener; async upload, selection restore, attached checks and insertion | Open subscription, captured insertion target, revision subscription, admitted insert result, root/focus | Existing media actions need an exact GIF payload and stale-request insertion contract. Keep provider/upload/cancellation UI and delete unused uploads on failed admission. |
| Exterior focus (`component/core/FocusClickTarget.tsx`) | Active range, focused state, last child's paragraph/empty status; append paragraph then select end in one update and focus | `hasSelection`, `editable`, atomic `focusAtEnd` | Shared UI already accepts native capability. Session host currently returns early without editing. No verified dedicated native append-empty-paragraph action at this base. Model owner must supply Source-equivalent atomic policy; DOM appending is invalid. |

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
