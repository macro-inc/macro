# Canvas Next — drawing, rich text, media and document cards

Open `/app/component/canvas-next` in local development. `USE_CANVAS_NEXT` is an
env-only flag enabled by default with Vite HMR. Set `VITE_USE_CANVAS_NEXT=false`
to hide the demo. The additional `LOCAL_ONLY` guard prevents an env override from
enabling it in deployed bundles.

This is a new composition inside `block-canvas`, using `@macro-inc/graphics`.
It does not use legacy Canvas state, Zod, document saving, or local storage.
`core/seed-scene.ts` supplies disposable data; reload or Reset demo starts fresh.
The older demos remain focused regression fixtures. Actual Canvas documents still
use the existing document host until the production gate in `docs/GRAPHICS_PARITY.md`.

## Controls

The floating top toolbar uses the shared `Toolbar` and Phosphor icons for drawing
and inserting media, document cards, and embeds. Tooltips show each tool's shortcut.
Zoom, reset-to-100%, fit, undo, and redo live at the bottom-left. Adjacent controls
toggle floating properties and layers panels; the canvas menu contains Reset demo.
The shared context menu exposes clipboard, grouping, layer ordering, select-all,
and delete actions, with normal keyboard navigation and focus restoration. Active
embedded editors and text editing retain their own context menus.

## Editing

| Action | Shortcut |
| --- | --- |
| Select / rectangle / ellipse / pencil / text / hand | V / R / O / P / T / H |
| Temporary pan | Hold Space, or middle-button drag |
| Add/remove selection | Shift-click; Shift-drag on empty canvas adds a marquee |
| Draw square / circle | Hold Shift while drawing a rectangle / ellipse |
| Move horizontally / vertically | Hold Shift while dragging; follows the dominant world axis |
| Select inside a group | Cmd/Ctrl-click |
| Copy / cut / paste | Cmd/Ctrl+C / X / V |
| Duplicate | Cmd/Ctrl+D, or Option/Alt-drag |
| Select all | Cmd/Ctrl+A |
| Nudge | Arrows: 1 world unit; Shift+arrows: 10 |
| Group / ungroup | Cmd/Ctrl+G / Shift+Cmd/Ctrl+G |
| Undo / redo | Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z |
| Delete | Backspace / Delete |
| Front / back | ] / [ |
| Forward / backward | Option/Alt+] / Option/Alt+[ |
| Cancel and return to selection | Escape |

Keyboard registration uses Macro's DOM scope and respects text/number inputs.
Native clipboard events own the actual copy/cut/paste keystrokes; proxied Macro
commands expose those actions in the command UI without double handling.
Clipboard context-menu actions use the browser clipboard API and report denied
access. Fragments include whole selected subtrees, fresh IDs on insertion, stable
relative order and world placement. Pasting repeatedly offsets by another 24 units.
Canvas Next fragments preserve rich text. Plain text and HTML pasted onto the canvas
create a wrapped text shape; pasting inside the editor belongs to Lexical. Image
clipboard data uploads through the media adapter. Legacy Canvas and Excalidraw
clipboard formats remain later adapters.

Option-drag duplicates the selected roots (or selects and duplicates the clicked
shape). It is a cancellable preview; originals stay put and retain their DOM.
Release commits creation plus movement as one undo step; clicking without moving
or pressing Escape leaves no copy or history entry. Hold Option at gesture start;
live modifier toggling during a duplicate drag is not implemented.

The inspector supports mixed values, fill/stroke palettes, width, opacity and
rectangle radius. Edits also become defaults for subsequent shapes. A group has
no inherited style: styling it edits all descendant shapes once. Ellipses ignore
radius. Numeric changes commit on change/blur, not on every digit.

Selections expose four visible corner handles and invisible targets along each full
edge, with a 10-screen-pixel hit area and resize cursors. Corners take priority
where they overlap an edge target. Groups and multiple selections have a dashed
world-axis-aligned box; single shapes retain their oriented solid box. The rotation
circle follows a single shape's oriented top edge; for groups and multiple selections
it is centered above the world bounds. Grips stay square. Edge cursors stay EW
(sides) or NS (top/bottom); corners use the diagonal arrow matching their world-space
quadrant relative to the selection center. Click-drag anywhere inside
the box moves the entire selection, including gaps; Shift/deep-select still pick
individual shapes. Option/Alt keeps the center fixed; Shift preserves proportions.
Shift-click toggles on release. Moving at least 3 screen pixels changes it into
an axis-constrained drag; an unselected target is added before moving the selection.
Shift also works when pressed/released during a move, including Option-drag duplicates.
During rectangle/ellipse creation, Shift keeps width and height equal; pressing or
releasing it updates the preview without losing the unconstrained pointer endpoint.
Handles and the shared bounding box hide during the preview, and each drag is one
undo step. Shared resizing stretches independently only when descendant axes align
with the box, including quarter turns; incompatible child rotations force uniform
scaling for corner and edge drags. This avoids shear and keeps the content fitted
to the box. Nonuniform resizing edits descendant geometry and moves centers while
retaining hierarchy; uniform resizing transforms selected roots once.
Resizing through the opposite edge flips the contents and keeps growing on the
other side. Each axis can invert independently; modifier changes recompute from
the original gesture, and undo/cancel restore the original geometry and handedness.

Active drags continue across pointer-capture loss and release outside the canvas;
Escape, focus loss and pointer cancellation still discard the preview.

Align uses selected roots' world bounds. Distribute makes equal gaps, keeps outer
objects fixed, and allows negative gaps for overlapping selections. Each command
is one undo step. Stroke width and radius are local dimensions: single-shape
resizing and nonuniform shared resizing edit geometry; uniform group/multiselection
scaling also scales these dimensions for rectangles and ellipses. Pencil absorbs
scale into its samples instead, preserving nominal brush width.
Picking accepts painted stroke pixels or the existing 3-screen-pixel minimum
outline tolerance; a thick stroke does not gain another 3px outside its paint.

## Ownership

- `core/`: seed/defaults only. Editing algorithms and typed commands live in graphics.
- `primitives/`: Solid state, mixed values, creation defaults and UI actions.
- `components/`: inspector and layer list with explicit props.
- `views/`: editor surface and controls composed around a supplied editor/state.
- `canvas-next.tsx`: local memory editor, Macro header/hotkey scope, clipboard wiring.
- `clipboard.ts` / `hotkeys.ts`: host adapters. No browser/app dependency in the core.

Core command and transform tests exercise both memory and Loro paths. The new UI
uses memory only; it does not install awareness or production collaboration.

## Pencil checkpoint

P selects the pencil tool. It stays active for repeated strokes; V or Escape
returns to selection. Tap for a dot. Mouse strokes simulate pressure from point
spacing; pens capture pressure, with coalesced input samples processed together.
The `perfect-freehand` brush is an internal graphics detail. Documents contain
local samples and pressure mode, and each completed stroke is one undo entry.

Selection bounds enclose the smoothed ink; clicks and marquee target that ink,
not raw samples or empty bounding-box space. Existing selected-box drag behavior
is unchanged. Resize scales points and recomputes pressure/ink with nominal pen
width retained, including uniform scaling through nested groups. Copy/paste,
Option-drag, styles, layering and local history use the shared shape pathways.

## Rich text checkpoint

T chooses text. Click for auto width, or drag horizontally to choose a wrapping
width. Double-click an existing text shape, or select it and press Enter, to edit.
Double-click empty canvas also creates text. Escape, Cmd/Ctrl+Enter, Done, or a click
outside commits the edit. Empty drafts disappear without an undo entry.

The editing toolbar supports bold, italic, underline, strike, code, highlight,
links, headings, quotes, nested bulleted/numbered lists, and paragraph alignment.
Tab / Shift+Tab indent/outdent lists. Lexical owns IME, caret/range selection, rich
clipboard and typing undo; canvas hotkeys and gestures are suspended while editing.
The inspector controls font family (sans/serif/mono), size and auto/wrapped width.
Side edges reflow at fixed font size. Corners and top/bottom scale proportionally.
Text corners follow the pointer projected onto the box's aspect-ratio diagonal,
so horizontal drags can shrink a wide line without vertical jitter dominating.
Scaling preserves the measured layout; width edits remeasure wrapping. Task mention
badges, assignee avatars, and mention spacing scale in em units with the text.

Type `@` in text or a shape label to open the shared mention picker. Choose a
person, document, or other supported reference with the mouse or arrow keys and
Enter. Escape closes the picker before ending editing. Mentions retain their typed
Lexical nodes through reopening, copy/paste, and undo, and render with the shared
mention decorators. This disposable demo disables backend mention tracking and
notifications; mentions remain part of the same whole-content LWW string.

Core stores `TextGeometry.content` as a stringified Lexical editor tree, including
shape labels. Canvas Next uses the shared Markdown builder (`buildConfig` and
`MarkdownShell`) for editing and `StaticLexical` for display and measurement.
The tree is never converted through Markdown when loading or saving. Core only
bounds/validates the JSON envelope and retains no Lexical, Solid, or DOM imports.
Only the actively edited shape mounts an editable Lexical instance.
Reordering other items therefore cannot remount the editor or replace its content.
Draft updates do not mutate the scene. Ending the edit submits one canvas undo
step, and undo inside the editor affects only that editing session.

Rectangles and ellipses own optional rich-text labels in their geometry. Double-click
anywhere inside either shape (even with no fill), use T then click the shape, or
select the shape and press Enter. Labels start center-aligned and vertically
centered, wrap to a padded interior (an inscribed box for ellipses), and uniformly
shrink to fit small shapes. Resizing remeasures wrapping without changing the stored
font size; labels inherit the shape's stroke color and opacity. Clicking a label
selects its owner. Ordinary clicks elsewhere in an unfilled interior still pass
through. Clearing a label leaves the shape. Label edits, copy/paste, duplication,
grouping and transforms all preserve ownership; there is no separate text node.

The collaboration policy is deliberately whole-content last-write-wins. Loro
stores one `textContent` string register per text item or labeled shape, separate
from pose. Concurrent edits choose one complete tree; no character-level merging
or shared caret is intended. Label layout metadata is separate from pose too, so
adding a label and moving its owner can merge. Local typing undo stays in Lexical;
finished edits use the canvas backend's undo. The local Canvas Next demo still has
no persistence or production SyncService connection.

Mixed selections containing text scale uniformly to preserve letter proportions;
use a single text shape’s side edges to change wrapping width. Shape definitions
express this through the `canDeform` capability used by selection-frame math.

## Arrows and connectors checkpoint

A selects Arrow, C selects Connector (rounded elbow), and L selects Line. Drag from
empty space or a shape. Hovering a shape reveals five small endpoint-style circles:
its center and four edge midpoints. Only the hovered shape shows these targets.
A center drop automatically meets the outline as the target moves; side drops stay fixed on the chosen edge. Points retain their
screen size at any zoom. The active point gets a larger pale-blue halo, both before
the first click and while dragging either endpoint. Near an edge point it takes
priority; farther inside the shape, its center is active (including unfilled shapes).

Select a connector to reveal two endpoint circles. Drag either to reconnect or
release in empty space to detach it. Shift snaps free endpoints to 45 degrees;
Escape cancels. The inspector switches between Straight, Elbow and Smooth routing
and the legacy open/filled arrowheads and large/small dots at either end. The
original route math lives in the pure graphics core, not in this app.

Target movement, rotation, resizing, nesting, grouping, copy/paste, duplication and
undo retain connections. Copying only the connector detaches its references at the
visible positions. Deleting a target leaves its surviving connectors in place;
undo restores the connection. Moving a connector body moves its free ends, keeping
bound ends attached. Endpoint previews do not write document history.

Connector labels, arbitrary bend-point editing, and remote endpoint preview
awareness are not included in this checkpoint. This remains a disposable local demo.

## Media and document cards

Add media accepts local images/videos (including HEIC conversion through the shared
uploader) and existing workspace media. Native file drop, image clipboard paste,
and workspace entity drag/drop use the same insertion path. Media is naturally
sized, fitted within 640 × 480 world units, and inserted in one undo step per batch.
Uploading/loading is host-owned; only stable static-file or document references
enter the scene. Reset/unmount invalidates pending insertion. Failures are shown in
the status line. This local scene is disposable, but uploads use the existing static
file service. Existing workspace file selection does not create a new file.

Image/video shape definitions own validation, bounds, hit testing and resizing in
core. The host resolves URLs through existing queries. Images support border,
opacity, radius, transformations (including flips), grouping, order and clipboard.
Select a video and use Play/Pause video in the inspector; playback is local state.

Add document inserts a document reference rendered with `DocumentPreviewContent`
in a 340 × 136 card, one surface layer above its parent and inserted at the front
of the scene. Card text uses `text-base` and reflows at its actual width;
resizing no longer scales a 320px snapshot. Titles, menus and task controls remain
interactive; dragging the card background moves it. Select the card and use Open document. Workspace drops and pasted Macro
links also insert document cards. Preview loading/errors stay inside the card's
Suspense/ErrorBoundary. Signed URLs, query results, media players, preview contents,
and upload state are never stored in core. SVG-to-editable-shape conversion is not
part of this checkpoint; SVG files can be inserted as images.


Add embed inserts a full Markdown document or existing canvas editor at 640 × 480.
A document card can switch between preview and embed in the inspector. Double-click
an embed or choose Interact to enter; Done, Escape, or a click elsewhere on this
canvas returns input to the outer canvas. Resizing changes the editor viewport.
The embedded block stays mounted when entering/leaving interaction mode.

`block-embed-adapter.tsx` mounts the existing unmanaged block loader with its own
panel handle, toolbar, and hotkey scope. The existing editor owns permissions and
sync: edits inside an embed save to that referenced file, even though the outer
scene remains local and disposable. The core stores only the document reference,
box size, and optional `display` (`preview`/`embed`). Active focus, selection inside
the embed, its editor state, and network services never enter graphics core.
Native clipboard events, pointer/wheel events and shortcuts remain owned by the
active embed. Full embeds currently support `md` and `canvas`; other files retain
preview cards. Production Canvas Next persistence and recursive Canvas Next
embedding are not part of this checkpoint.

Known prototype limit: the embedded legacy canvas still converts pointer coordinates
against an untransformed viewport. Its drawing/resize tools need host-transform
mapping before they can be relied on inside zoomed, rotated, or flipped outer
scenes. Document text editing uses browser-native layout/hit testing. Browser
verification covered editor mounting, local controls, independent canvas panning,
preview font sizing, conversion, and input enter/exit without editing source files.
