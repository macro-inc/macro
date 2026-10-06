# Canvas Next — drawing, rich text, media and document cards

Canvas Next opens saved documents behind the remote `enable-canvas-next` flag.
Use `VITE_ENABLE_CANVAS_NEXT=true` in `apps/web/.env.local` to opt in locally.
Local analytics is disabled, so unset remote flags settle as off without waiting
for PostHog. Deployed builds use the remote rollout when no override is set. The flag is sampled when
opening a document, so remote refreshes cannot switch an active editing session.

The frontend treats unversioned JSON (and explicit version 1) as legacy Canvas.
It converts supported records on load to `{ version: 2, document, legacy? }`.
`document` is the graphics scene; `legacy` retains the original JSON and migration
notes for recovery. No migration is saved merely by viewing a file. The first
committed edit writes version 2 using the existing JSON/simple-save endpoint.
Subsequent loads validate version 2 directly; they never replay the archived data.
Unknown versions and invalid scenes fail closed. With the flag off, version 2
files show a Canvas Next requirement instead of opening in the legacy editor.

Migration preserves IDs, groups, stacking order, positions, shape labels,
Markdown text, connector bindings/styles, media references and flips, and document
references. Pencil samples are retained and use the new brush. Unsupported links,
non-document entity cards, subpath references, connector labels, invalid records,
and interleaved group layers offer **Open in legacy editor** without writing data.
There is no version 2-to-legacy downgrade. Document-level read-only mode mounts a
navigation-only surface without editing, paste/drop, or embedded editing handlers.
Saves are debounced and serialized; failures keep edits dirty and show **Retry**.

SyncService integration and collaboration remain a follow-up. This change keeps
the existing whole-file save behavior. See [Graphics and Canvas parity](../../../../../../docs/GRAPHICS_PARITY.md)
for the remaining editor and collaboration work.

## Controls

The floating top toolbar uses the shared `Toolbar` and Phosphor icons for drawing
and inserting media, document cards, and embeds. Tooltips show each tool's shortcut.
Zoom, reset-to-100%, fit, undo, and redo live at the bottom-left. Adjacent controls
toggle floating properties and layers panels.
Fit Scene uses the current viewport dimensions, centers all scene geometry and
zooms in or out to leave 100 screen pixels per side on the first axis to fill.
Camera zoom limits still apply; padding decreases for small embedded viewports.
Ctrl/Meta-wheel zoom is pointer-anchored, with a continuous 0.002 exponential rate
per normalized wheel pixel and an exponent cap of 0.2 per event (about 22% zoom-in).
Plain wheel input pans at its existing speed.
The Design panel's zoom menu offers **No snapping** (the default for each session),
**Snap to px** (1 canvas px at every zoom), and **Auto snapping** (the smallest
currently visible dot-grid interval, including faint dots). Auto follows zoom;
hiding the grid temporarily disables it. Drawing, moving, resizing, insertion, duplication, pasting, free
connector endpoints and layout inspector values use the chosen interval; inspector
scrubs preview the same snapped values they commit. Freehand and rotation keep
their own precision, and connector bindings and aspect-ratio constraints stay exact.
The preference is local editor state, not saved JSON or shared Loro data.
The dot grid adapts to zoom, revealing 1, 4, 16, 64 px levels (and
coarser levels at extreme zoom-out). Coarse dots remain steady while finer dots
fade in gently; individual canvas pixels are faintly visible at 800%. Dots use
fixed 1 screen-pixel SVG marks, including at fractional zoom. Marks closer than
4 screen pixels disappear to avoid a dense texture. Their centers stay anchored
to canvas coordinates through pan/zoom. Colors blend the theme's muted ink and
panel tokens; the dot-grid visibility toggle hides every level.
The shared context menu exposes clipboard, grouping, layer ordering, select-all,
and delete actions, with normal keyboard navigation and focus restoration. Active
embedded editors and text editing retain their own context menus.
Selecting Arrow, Line, Connector, or Pencil repairs invisible drawing defaults:
missing/transparent strokes use theme Ink, zero width uses 2 px, and zero opacity
uses full opacity. Other style choices and existing shapes are preserved.

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
| Nudge | Arrows: one snap unit; Shift+arrows: ten snap units |
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
clipboard data uploads through the media adapter. Legacy Canvas clipboard format
remains a later adapter.

Pasting an Excalidraw selection or `.excalidraw`/`excalidraw/clipboard` JSON
imports through `core/excalidraw.ts` (import only; export is not implemented). It
converts rectangles, ellipses, text, freedraw and line/arrow elements, rebuilds
flat `groupIds` membership into the nested local-transform tree, folds
container-bound text into shape or connector labels, and keeps arrow bindings
that resolve to imported shapes. Diamonds are approximated as rectangles; images,
frames and embeddables are dropped. The status line reports the imported, approximated and
unsupported counts. Hachure/fill styles, roughness and multi-point line bends are
not represented. Connectors import as straight unless both endpoints bind to
imported shapes; doubly bound connectors retain their straight, smooth or elbow route.

Option-drag duplicates the selected roots (or selects and duplicates the clicked
shape). It is a cancellable preview; originals stay put and retain their DOM.
Release commits creation plus movement as one undo step; clicking without moving
or pressing Escape leaves no copy or history entry. Hold Option at gesture start;
live modifier toggling during a duplicate drag is not implemented.

The inspector stays in a rounded floating panel on the right at the same width
and height, including with no selection. Connector routes, endpoint styles, and
stroke patterns have previews in both their selectors and menus. Rotation and
flip buttons share the alignment controls’ compact grouped treatment. Sections follow Position, Layout, Appearance, Fill, Stroke,
Connection, Typography; unavailable sections are omitted without reordering the
others. Position and Layout remain visible but disabled for fully bound connectors.
Compact fields share a two-column grid, opacity and corner radius share Appearance,
and label typography appears only for existing labels or during label editing.
The inspector supports mixed values, fill/stroke palettes, width, opacity and
rectangle radius. Width/height edits and scrubs resize geometry through the canvas
shape definitions, preserving label proportions and remeasuring wrapping. Text
width reflows; text height scales proportionally. Rotated world-bound edits and
groups with incompatible axes preserve proportions rather than introducing shear.
Color controls compose the shared `@ui` ColorPicker field, hue
and opacity tracks, and hex input. Canvas does not import the theme editor picker
or Color.js; custom edits produce sRGB hex, while preset theme references stay
as references until edited. Edits also become defaults for subsequent shapes. A group has
no inherited style: styling it edits all descendant shapes once. Ellipses ignore
radius. Typing numbers commits on change/blur. Dragging a numeric handle previews
the scene continuously, then commits one undo step on release. Escape, lost pointer
capture, or leaving the window restores the starting scene without saving a change.
Previews always use the starting document, so rotation and resizing do not accumulate
rounding errors between samples.

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
- `canvas-next.tsx`: memory editor, Macro hotkey scope and clipboard wiring.
- `clipboard.ts` / `hotkeys.ts`: host adapters. No browser/app dependency in the core.

Core command and transform tests exercise both memory and Loro paths. Canvas Next
currently uses memory plus versioned whole-file saves; it does not install awareness
or production collaboration.

The view/state already accept an editor. The current composition root constructs
its own memory editor; a later collaboration checkpoint can inject Loro editors while
retaining the same rich-text measurement, renderer, clipboard and input ownership.

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

The 2026-09-28 performance fix preserves immutable core geometries for rendering
and hit queries and retains geometry through move/rotation previews. This reuses
derived ink during pan, hover, selection and transforms; raw samples are unchanged.
The 11-stroke/7,041-sample regression checks brush executions, not a browser FPS
budget. Mixed-content performance and general spatial indexing remain later work.

## Rich text checkpoint

T chooses text. Click for auto width, or drag horizontally to choose a wrapping
width. Double-click an existing text shape, or select it and press Enter, to edit.
Double-click empty canvas also creates text. Escape, Cmd/Ctrl+Enter, or a click
outside commits the edit. Empty drafts disappear without an undo entry.

The editing toolbar supports bold, italic, underline, strike, code, highlight,
links, headings, quotes, and nested bulleted/numbered lists.
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
Enter. Pending `@` queries use the same text width as their measured content, so
opening the picker does not add an extra wrapped line. Escape closes the picker
before ending editing. Mentions retain their typed
Lexical nodes through reopening, copy/paste, and undo, and render with the shared
mention decorators. Canvas Next currently disables backend mention tracking and
notifications; mentions remain part of the same whole-content LWW string.

Canvas Next stores a stringified Lexical editor tree in `TextGeometry.content`,
including shape labels. `core/text-codec.ts` owns bounded tree validation, seed
construction, serialization, plain-text extraction and empty-content detection.
Clipboard imports validate this host format before accepting a scene. Graphics
only checks the opaque string's size; it never interprets the tree
or decides whether to remove empty text. The text state explicitly deletes cleared
text items, skips empty creations and clears labels while retaining their shapes.
Canvas Next uses the shared Markdown builder (`buildConfig` and `MarkdownShell`)
for editing and `StaticLexical` for display and measurement, with its own markup
styles. The tree is never converted through Markdown when loading or saving.
Whole-string LWW and existing serialized content remain unchanged.
Only the actively edited shape mounts an editable Lexical instance.
The editing surface has no additional colored box outline; native text selection
and the caret remain visible. Selection indicators return after editing finishes.
Reordering other items therefore cannot remount the editor or replace its content.
Draft updates do not mutate the scene. Ending the edit submits one canvas undo
step, and undo inside the editor affects only that editing session.

Rectangles, ellipses and connectors own optional rich-text labels in their geometry.
Double-click inside a rectangle or ellipse (even with no fill), or on a connector.
You can also use T then click, or select the item and press Enter. Connector labels
sit at the route midpoint, follow bound targets, and size to their text; the
connector line leaves a gap behind the label. Other labels start
center-aligned and vertically centered, wrap to a padded interior (an inscribed
box for ellipses), and uniformly shrink to fit small shapes. Resizing remeasures
wrapping without changing the stored font size; labels inherit the shape's stroke color and opacity. Clicking a label
selects its owner. Ordinary clicks elsewhere in an unfilled interior still pass
through. Clearing a label leaves the shape. Label edits, copy/paste, duplication,
grouping and transforms all preserve ownership; there is no separate text node.

The collaboration policy is deliberately whole-content last-write-wins. Loro
stores one `textContent` string register per text item or labeled shape, separate
from pose. Concurrent edits choose one complete tree; no character-level merging
or shared caret is intended. Label layout metadata is separate from pose too, so
adding a label and moving its owner can merge. Local typing undo stays in Lexical;
finished edits use the canvas backend's undo. Canvas Next does not yet have a
production SyncService connection.

Mixed selections containing text scale uniformly to preserve letter proportions;
use a single text shape’s side edges to change wrapping width. Shape definitions
express this through the `canDeform` capability used by selection-frame math.

## Arrows and connectors checkpoint

A selects Arrow and L selects Line; C remains available for the app's Create menu.
Choose Elbow in the Connection inspector for a rounded connector. Drag from
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

Arbitrary bend-point editing and remote endpoint preview awareness are not included
in this checkpoint.

## Media and document cards

Add media accepts local images/videos (including HEIC conversion through the shared
uploader) and existing workspace media. Native file drop, image clipboard paste,
and workspace entity drag/drop use the same insertion path. Media is naturally
sized, fitted within 640 × 480 world units, and inserted in one undo step per batch.
Uploading/loading is host-owned; only stable static-file or document references
enter the scene. Reset/unmount invalidates pending insertion. Failures are shown in
the status line. Saved Canvas Next documents retain stable uploaded references;
uploads use the existing static file service. Existing workspace file selection
does not create a new file.

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
Suspense/ErrorBoundary. Loading shows a pulsing icon dot and two title skeleton
lines, shared with DocumentPreview. Signed URLs, query results, media players, preview contents,
and upload state are never stored in core. SVG-to-editable-shape conversion is not
part of this checkpoint; SVG files can be inserted as images.


Add embed inserts a full Markdown document or existing canvas editor at 640 × 480.
A document card can switch between preview and embed in the inspector. Double-click
an embed or choose Interact to enter; Done, Escape, or a click elsewhere on this
canvas returns input to the outer canvas. Resizing changes the editor viewport.
The embedded block stays mounted when entering/leaving interaction mode.

`block-embed-adapter.tsx` mounts the existing unmanaged block loader with its own
panel handle, toolbar, and hotkey scope. The existing editor owns permissions and
sync: edits inside an embed save to that referenced file independently of the outer
Canvas Next document. The core stores only the document reference,
box size, and optional `display` (`preview`/`embed`). Active focus, selection inside
the embed, its editor state, and network services never enter graphics core.
Native clipboard events, pointer/wheel events and shortcuts remain owned by the
active embed. Full embeds currently support `md` and `canvas`; other files retain
preview cards. Recursive Canvas Next embedding remains gated by the referenced
document's own format and feature availability.

Known prototype limit: the embedded legacy canvas still converts pointer coordinates
against an untransformed viewport. Its drawing/resize tools need host-transform
mapping before they can be relied on inside zoomed, rotated, or flipped outer
scenes. Document text editing uses browser-native layout/hit testing. Browser
verification covered editor mounting, local controls, independent canvas panning,
preview font sizing, conversion, and input enter/exit without editing source files.

## Large-scene regression coverage

`packages/graphics/tests/large-scene.test.tsx` mounts 2,000 rectangles across
three groups and checks stable shape mounts and scale computations during pan,
selection, and group movement. Scene hierarchy, paint order, and picking bounds
are indexed on immutable snapshots; edits and undo replace those indexes.
Selection outlines share a camera transform so panning does not rewrite every
outline. Mutable scene builders continue to bypass caches.
