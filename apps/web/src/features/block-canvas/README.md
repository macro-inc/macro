# block-canvas — drawing, rich text, media and document cards

Canvas Next is the default editor for saved canvases, drive details, and embeds.
No rollout flag or local override is required.

Both the Drive detail and block hosts use `queries/document.ts` to authorize and
select shared content before fetching a legacy file seed. Native canvases never
require a presigned blob URL.

**Ask Macro** in the Drive header and standalone title menu attaches the canvas to an agent conversation
on desktop and mobile. `ReadCanvas` inspects its live scene; `EditCanvas` runs
bounded SDK commands as a peer in that same Loro room. Results show acknowledged
operation counts and expandable outcomes. Unrelated concurrent edits survive.
Text remains a whole-string register; new media/document references and deletion
of embedded items stay in the authorized UI flow. See the worker
[Canvas flow](../../../../../services/ai-editing-worker/AI_EDITING.md#canvas).

The frontend treats unversioned JSON (and explicit version 1) as legacy Canvas.
It converts supported records on load to `{ version: 2, document, legacy? }`.
`document` is the graphics scene; `legacy` retains the original JSON and migration
notes for recovery. No migration is saved merely by viewing a file. Native Canvas creation initializes the canonical versioned Loro snapshot on the backend and marks content ready in SyncService before returning. `POST /documents/create_canvas` and CreateDocument with empty Canvas content share this lifecycle. Native loading uses the content location and does not request an S3 presigned URL. The first editor opening a legacy S3 canvas migrates its scene into one versioned Loro snapshot in SyncService. The server serializes initialization; competing openers import only
the winning seed. Subsequent opens use the shared scene and never replay the
original JSON over live edits. JSON remains the import/export format and retains
the legacy source for recovery.
Unknown versions and invalid scenes fail closed without writing data.

Migration preserves IDs, groups, stacking order, positions, shape labels,
Markdown text, connector bindings/styles, media references and flips, and all
legacy entity references. Pencil samples are retained and use the new brush.
Unsupported links, connector labels, invalid records, and interleaved group layers
show a migration error without writing data. The legacy editor has been removed.
There is no version 2-to-legacy downgrade. Document-level read-only mode mounts a
selection/navigation surface without editing, paste/drop, or embedded editing handlers.
Markdown embeds explicitly pass `isEmbedded` to the editor and use this same
read-only surface, with Select and Hand tools and no property inspector. Selection
does not expose transform handles or mutate the scene; embedded views cannot save
canvas edits even when the viewer has edit permission on the original document.
Shared edits use the existing collaboration runtime, IndexedDB snapshot/WAL
recovery, and live SyncService transport. Whole-file simple-save has been removed.
Download/export reads the current shared scene; copying a canvas copies its
live room as well as its original JSON seed. Viewers and embeds join existing
rooms read-only and do not initialize a room. Before initialization they can view
the original JSON while waiting for an editor to share it. Initial connection or
local-storage failures keep the original file read-only with a Retry action;
a recovered local snapshot supports editing while disconnected. Undelivered edits
remain in the WAL and trigger a browser unload warning.
Failed local appends stay buffered in the open session; Retry saving retries
them without replacing the scene. Sources bind to the opening account and check
fresh access on reconnect; only edit/owner grants permit scene writes.

Other people see live cursors, selections, and drawing/transform previews. Presence
uses the shared awareness channel, publishes at most every 40–100 ms while moving,
heartbeats every three seconds, and expires after ten seconds without updates.
It never changes document data or undo. Mixed-content previews use bounds for
text, connectors, media, and document cards. Selection/camera/tools stay local.
Incoming scene changes cancel active canvas gestures; intent rebasing is deferred. See [Graphics and Canvas parity](../../../../../docs/design/graphics-parity.md)
for the remaining editor and collaboration work.

## Artifacts

An `artifact` node runs a self-contained HTML
document in `views/artifact-frame.tsx`. The frame's sandbox is `allow-scripts`
only, so the document has an opaque origin with no access to Macro's cookies,
storage or DOM. Never add `allow-same-origin`. `core/artifact-document.ts` writes
a content security policy ahead of the artifact's own markup, which blocks network
requests, nested frames and form posts. Images and fonts must be inline.

A policy cannot follow a navigation, and a sandbox does not stop a frame navigating
itself. Each composed document therefore announces its load to the host with a token, from
a script that removes itself before artifact code runs. A load without the token puts
the artifact's own document back, and an artifact that keeps leaving is stopped, but the first request of each navigation has already been
sent. Browsers also do not apply the policy to WebRTC.
So an artifact cannot reach Macro's data, but it can send out what it already holds:
treat artifact source, and anything typed into an
artifact, as readable by whoever wrote it. Artifacts mount only while on screen, so
off-screen scripts stop and restart with fresh state. With the flag off, a node
shows its title and no script runs. The headless render bundle has no flag reader,
so its caller says whether to run artifacts, in the same sandbox.

Each canvas has a library of named styles and components, in root Loro maps beside
the scene, edited from the inspector. An artifact uses them with
`<macro-style name="brand"></macro-style>` and
`<macro-component name="card">children</macro-component>`, whose children replace
the component's `<slot>`. They expand when the document is composed, so a library
edit updates every artifact using it. JSON export carries only the scene, so a
downloaded canvas loses its library.

AI can create and edit artifacts and the library for users with the flag. See
[Canvas architecture](../../../../../docs/architecture/canvas.md#artifacts).

**Present** on a node opens `views/artifact-presentation.tsx`, full screen where the
browser allows and otherwise covering the window. It steps through artifacts only,
in `presentOrder`, stopping at each end; new artifacts go last, and the inspector
reorders them. Arrow keys, Space and Page Up/Down step, and Esc exits. Focus inside
a frame keeps keys from the host, so `composeArtifactDocument` adds a small script
that forwards these keys unless the artifact handled them or the user is typing.
The host treats those messages only as navigation. Touch devices use the on-screen
buttons.

## Desktop and touch views

`canvas-next.tsx` is the entry: it owns the editor, state, clipboard and hotkeys,
and holds the view's device switch. The pane's header is switched beside it, in
`component/Block.tsx`, between `views/canvas-header.tsx` and
`views/mobile/canvas-header.tsx`. `views/canvas-view.tsx` and
`views/canvas-read-only-view.tsx` are the desktop compositions,
`views/mobile/` the phone and tablet ones, and `views/shared/` the parts both
render: `CanvasViewParts` (the root that wires the viewport, the scene, the
insert menu, the presentation and the empty state), `CanvasInspectorSections`,
`CanvasReadOnlyParts`, and `CANVAS_TOOLS`, which names and draws each tool
while every view lists the tools it offers. A canvas embedded in a document
keeps its controls inside the embed: the desktop read-only view on desktop, and
on touch `views/mobile/canvas-embedded-view.tsx`, which lets the document
scroll. There one finger or a pen over the canvas scrolls the document and the
plain wheel does too (`yieldToPage` on the surface: `touch-action: pan-x pan-y`,
and presses other than a mouse's ignored), while two fingers, a trackpad pinch
and Ctrl/Cmd-wheel still move the canvas. **Interact** gives the canvas every
gesture, with the Hand tool, until **Done** or a press elsewhere in the
document. Zoom to fit and Done then sit at the bottom of the screen, above the
dock, because the embed's own corner may be out of reach.

On touch the canvas's controls are islands in the app's bottom chrome, in the
`accessory` float region above the dock, so the dock, the home indicator and
the keyboard never cover them, and the page's New button gives way while a
canvas is open. Zoom and undo/redo sit on the left, the drawing tools in the
middle, and, while something is selected, Style, Duplicate, Delete and More on
the right. They share one row wherever it fits (tablets, a phone on its side);
an upright phone stacks the tools under the rest. Where there is no room to list
every tool, Rectangle and Ellipse fold into one button and Arrow, Line and
Connector into another: a tap picks the group's last tool, and a tap while it is
picked opens the others. A read-only canvas offers zoom, Select and Hand. The
chrome steps aside while the keyboard is up. A press on it first commits text
being edited and leaves an embed, as a press on the canvas does, because the
float region renders it outside the canvas's own root. On a page without the
app's bottom chrome (a public link opened signed out) there is no float region,
and the same islands sit at the bottom of the canvas instead.

The zoom button opens a sheet with what the desktop zoom menu holds: fit, zoom
to selection, zoom levels, the dot grid and snapping. It also holds **Keep tool
after drawing** (`toolLocked` in the canvas state): a drawing tool normally hands
back to Select after one shape, line or text, which costs a finger a trip to the
toolbar for every further one; kept, it stays and nothing is selected. The lock
acts only while a drawing tool is chosen (`keepsTool`): under Select, a text
edited or a connector's end dragged stays selected. More, and a long press on
the canvas with Select or Hand, open a sheet with every context-menu action:
clipboard, duplicate, select all, group, layer order and delete. Copy leaves the
sheet open and confirms with a check, as copy actions do in other menus. A long press
first selects what is under the finger, as a right-click does, and cancels
whatever the press had started; `longPress` on the graphics input reports it,
half a second in, if the finger has drifted no more than 10px. The sheet opens
under the finger, and a browser clicks whatever is under a finger as it lifts,
so the graphics input swallows that lift's click: letting go presses no row.
When the press
landed on an item inside the group it selected, the sheet adds Select inside
group, which selects that item alone: a finger has no Cmd/Ctrl-click.

On a phone Style opens the inspector in a sheet over the lower half of the
screen. Its scrim is clear, so the shape stays visible and a change shows as it
is made, and a tap on the canvas closes it with the selection kept. The colour
picker is a popover that would cover the shape, so in the sheet each colour
field also lists its swatches in a row (`swatchRow` on `InspectorColorField`),
the palette and then the canvas's own colours. Wider touch
screens keep the inspector as a floating panel on the right, between the split
header and the bottom chrome; Style collapses it, remembered for the browser
session.

## Controls

The floating top toolbar uses the shared `Toolbar` and Phosphor icons for drawing
and inserting media, document cards, and embeds. Tooltips show each tool's shortcut.
Zoom, reset-to-100%, fit, undo, and redo live at the bottom-left. Adjacent controls
toggle floating properties and layers panels.
On desktop, Fit Scene and menu/keyboard zoom use the full canvas viewport without
subtracting floating panels. Fit Scene centers all scene geometry and
zooms in or out to leave 100 screen pixels per side on the first axis to fill.
The touch views fit into the part of the canvas their chrome leaves clear, with
24px around the content: `MobileCanvasChrome` lays a frame between the header and
the bottom chrome (and left of the side panel when it is open) and hands it to
`frameWithin` (`views/shared/canvas-framing.ts`). Sheet zoom levels zoom about the
middle of that frame. The view follows the frame: until the person has moved the
canvas, the last fit is redone when the frame changes (the chrome is measured
after the first paint, and a rotation changes everything); once they have, a
rotation keeps what was in the middle in the middle, and chrome that grows or
shrinks, or a keyboard that makes the view shorter, moves nothing. A fit of an
empty canvas is not kept up, and neither is any fit once a press lands on the
canvas or text is being typed.
Camera zoom limits still apply; padding decreases for small embedded viewports.
Ctrl/Meta-wheel zoom is pointer-anchored, with a continuous 0.01 exponential rate
per normalized wheel pixel and an exponent cap of 0.6 per event (about 82% zoom-in).
Plain wheel input pans at its existing speed.
On a touchscreen two fingers navigate in every tool, editable or read-only: their
midpoint pans, their spread zooms around it, and a flick glides to a stop. One
finger still belongs to the tool. A second finger landing drops whatever the first
started (marquee, move, resize, shape, stroke, connector, erase, text box) with no
history entry and restores the selection from before it; a finger left behind does
nothing until every finger has lifted. Touches inside an embed being interacted
with, or inside text being edited, stay with that editor. A pen or mouse that is
already pressed keeps its gesture, and fingers landing meanwhile do not
navigate. Beside a pen they are a resting palm, so no tool hears of them
either, until they lift. A pen that lands among fingers takes the surface from
them: what one finger had started is dropped the same way, navigation stops
where it is, and the fingers do nothing more, and reach no tool, until they
have lifted and landed again. A two-finger flick glides only when the fingers
were travelling together as they lifted: a pinch, whose midpoint also drifts,
does not, and neither does a gesture the system cancelled.
Each finger reports its own moves, so the camera is moved once per animation
frame, to where both fingers are by then, rather than once per event.
`attachTouchNavigation` in `packages/graphics/src/browser` owns this for every
`GraphicsSurface`; the glide and the pinch math are `@macro-inc/graphics/pan-zoom`,
which the lightbox and opened images also use for their momentum.

In the touch view the first press of a pen gives the drawing to the pen
(`drawsWith` in the canvas state, for as long as the canvas is open). From then
on one finger pans under any tool but Select, Hand and Text, as two fingers do,
and the tool never sees it (`fingerPans` on the graphics input). It pans only
once it has moved 10px from where it landed, so a hand that merely settles
moves nothing, and it glides on a flick. Once a pen has been seen the zoom
sheet offers **Draw with pen only**, which hands drawing back to fingers when
switched off; later pen presses do not switch it on again. The desktop view
passes no `fingerPans` and has no pen mode.

The Canvas panel's zoom menu offers **No grid snapping** (the default grid mode for each session),
**Snap to px** (1 canvas px at every zoom), and **Auto snapping** (the smallest
currently visible dot-grid interval, including faint dots). Auto follows zoom;
hiding the grid temporarily disables it. Drawing, moving, resizing, insertion, duplication, pasting, free
connector endpoints and layout inspector values use the chosen interval; inspector
scrubs preview the same snapped values they commit. Freehand and rotation keep
their own precision, and connector bindings and aspect-ratio constraints stay exact.
The preferences are local editor state, not saved JSON or shared Loro data.
**Snap to objects** is independently enabled by default. Moving selections snap
their combined world bounds' edges and centers to nearby objects; axis-aligned
resize handles snap their moving edges. Matching axes show dashed guides and
prefer object alignment over grid snapping. The tolerance is six screen pixels,
with a 160-screen-pixel perpendicular reach. Shift constraints and proportional /
centered resizing remain intact; rotated resize frames retain local-axis behavior.
The graphics engine caches sorted alignment anchors with perpendicular interval
trees per immutable scene snapshot (O(n log n) construction). Each pointer update
queries a constant number of selection anchors and prunes distant candidates,
including long rows and columns, instead of comparing every selected object with
every scene object. Selected objects, descendants, and ancestors are excluded.
Gesture telemetry records query, candidate, and visited-index-node counts; its
span measures the gesture, not cold index construction.
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
With exactly one image selected, the context menu and inspector also offer
**Copy image** and **Save image** for the original image, without canvas styling
or transforms. These reuse the shared image actions (including native mobile
sharing) and stay disabled while the image source or an action is pending.
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
| Paste in place | Shift+Cmd/Ctrl+V |
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
relative order and world placement. Copies include the source canvas ID: pasting
within that canvas offsets each repeat by another 24 units. Fragments from another
canvas (or without source metadata), including Excalidraw imports, are centered as
a whole in the current viewport, accounting for pan and zoom. Shift+Cmd/Ctrl+V
and **Paste in place** preserve original world coordinates without grid snapping.
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
frames and embeddables are dropped. Hachure/fill styles, roughness and multi-point
line bends are not represented. Connectors import as straight unless both endpoints
bind to imported shapes; doubly bound connectors retain their straight, smooth or
elbow route.

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

A finger gets larger targets than a cursor, decided by the pointer type of each
press, while the handles are drawn the same size. A touch within 16px of a
corner or the rotation knob, or 12px outside an edge, takes that handle even
though nothing is drawn under it (`touchHandleAt` in the graphics core). A corner
claims only the outer quarter of each side that meets at it, so a short side (one
line of text) keeps its middle for its edge handle. Inside the frame the reach
shrinks with it (a quarter of the shorter side for a corner, a sixth and at most
8px for an edge), so the middle of a small shape still moves it; where the reach
finds no handle a finger takes none, even on the strip drawn along the edge of a
thin shape. Outside the frame the reach ends at another item's paint: a press
there selects or drags that item. Inside the frame a press is the selection's,
whatever is painted there, as it is for a cursor. A finger
resizes or rotates once it has moved 3px; one that only taps near a handle
changes nothing, and outside the frame it selects what it tapped or clears the
selection. A touch that lands on nothing picks a stroke from 10px away rather
than 3; paint under the finger always wins over a stroke that is merely near.
The touch view also sets `touchHandles` on the surface, which holds for every
pointer there: the rotation knob stands 32px off the frame instead of 16, a
connector's endpoints are taken from 16px, and the corner-radius handles, which
sit inside each corner, are left to the inspector's Corner radius field. An
endpoint's reach holds over other items' paint, unlike a handle's: an end usually
sits on the shape it is attached to, and only a selected connector has ends to
take. An end taken from a distance (by a finger or pen, or by any pointer on
that wider target) keeps its distance from the pointer and moves once the
pointer has moved 3px, so a tap leaves the end, and what it is bound to, alone.
A cursor that presses the end itself places it under the cursor, as on desktop.

## Ownership

- `core/`: seed/defaults only. Editing algorithms and typed commands live in graphics.
- `primitives/`: Solid state, mixed values, creation defaults and UI actions.
- `components/`: inspector and layer list with explicit props.
- `views/`: editor surface and controls composed around a supplied editor/state,
  split into desktop, `mobile/` and `shared/` (see Desktop and touch views).
- `canvas-next.tsx`: shared Loro editor (or read-only JSON before sharing), hotkeys,
  clipboard, and the device switch between the desktop and touch views.
- `queries/canvas-session.ts`: shared runtime, initialization, recovery, permissions and teardown.
- `primitives/create-canvas-presence.ts`: ephemeral cursor/selection/gesture publication.
- `clipboard.ts` / `hotkeys.ts`: host adapters. No browser/app dependency in the core.

Core command and transform tests exercise both memory and Loro paths. Session
integration tests use three peers and cover merging, undo, competing initializers,
read-only access and recovery. The backend-free Playwright fixture runs the real
canvas session, shared backend and presence overlays with rendered editor surfaces:
`bunx playwright test --config src/features/block-canvas/browser-test/playwright.config.ts`
from `apps/web`. This exercises the runtime against an in-memory SyncService stand-in;
it does not establish a production participant limit or verify hosted transport.

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
width. The text tool acts when the press is released, on new text and on existing
text or labels alike, so a cancelled press (a second finger landing to pinch)
opens no editor. A pen or mouse press outranks a touch: a palm that lands beside
the pen cannot take the press, and a pen takes it from a palm already resting.
Double-click an existing text shape, or select it and press Enter, to edit.
Double-click empty canvas also creates text. Escape, Cmd/Ctrl+Enter, or a click
outside commits the edit. Empty drafts disappear without an undo entry.
On touch the on-screen keyboard going away also commits it, returns to Select and
selects the text: a phone's Done button takes the focus from the text to nowhere
(`focusout` without a `relatedTarget`), and a tablet's hide key leaves the focus
in place, so there `onKeyboardClosed` watches the app's keyboard state and the
visual viewport growing back. While text is typed the touch views keep it inside
the frame and the visual viewport (`keepInFrame` in `views/shared/canvas-framing.ts`):
the canvas pans as the keyboard comes up and as the text grows, and the page
itself is put back if the browser scrolled it to reveal the caret, so the
header stays on screen. Text that fits is kept whole; text larger than the
frame follows its caret and is otherwise left where the person put it. The
keyboard closing because the focus moved to one of the editor's own menus, or
the window losing focus, does not commit. On every device a scroll the browser gives the canvas
surface (a caret typed past its edge) is turned into the same pan and undone, so
presses keep landing where they are aimed.

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
AI editing uses `editor.mentionUser(itemId, at, {userId, email, displayName?})`
to insert the same chip into text or a label while preserving its rich content.
ReadCanvas returns bounded `userMentions` identities and offsets; offsets count
UTF-16 text, newlines, and one U+FFFC per chip. The agent resolves real people
through supplied identities or `macro.users.search` and disambiguates matches.
The host remeasures and revalidates the complete batch before committing.

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
finished edits use the canvas backend's undo. Canvas Next uses the production SyncService connection. An unchanged text draft
does not overwrite remote text on blur; remote deletion closes its draft, and
remote movement updates the draft position. Simultaneous text edits still choose
one completed content string rather than merging characters.

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

The toolbar media insertion control is currently hidden pending a UI redesign.
Native file drop, image clipboard paste, and workspace entity drag/drop continue
to use the existing insertion path. Media is naturally
sized, fitted within 640 × 480 world units, and inserted in one undo step per batch.
Uploading/loading is host-owned; only stable static-file or document references
enter the scene. Reset/unmount invalidates pending insertion. Saved Canvas Next
documents retain stable uploaded references;
uploads use the existing static file service. Pasted and dropped files show local
blob previews at their insertion positions while uploads finish. These previews
are not editable scene items; failures, reset, and unmount release their URLs.
Image nodes reserve their full bounds with the shared `skeleton-shimmer` and
`bg-skeleton` classes until the browser loads the image, including in read-only
canvases. Existing workspace file selection
does not create a new file.

Image/video shape definitions own validation, bounds, hit testing and resizing in
core. The host resolves URLs through existing queries. Images support border,
opacity, radius, transformations (including flips), grouping, order and clipboard.
Select a video and use Play/Pause video in the inspector; playback is local state.

Workspace document drops insert a document reference rendered with
`DocumentPreviewContent` in a 340 × 136 card, one surface layer above its parent
and inserted at the front of the scene. Card text uses `text-base` and reflows at
its actual width; resizing no longer scales a 320px snapshot. Titles, menus and
task controls remain interactive; dragging the card background moves it. Select
the card and use Open document. Workspace drops and pasted Macro links also insert
document cards. Preview loading/errors stay inside the card's
Suspense/ErrorBoundary. Loading shows a pulsing icon dot and two title skeleton
lines, shared with DocumentPreview. Signed URLs, query results, media players,
preview contents, and upload state are never stored in core. SVG-to-editable-shape
conversion is not part of this checkpoint; SVG files can be inserted as images.


The drawing toolbar’s paperclip **Attach** button (shortcut hint `I`) opens a
standard dropdown for Media, Upload media, and Reference. Its pickers appear
above the toolbar and place attachments at the canvas center.

Press `I` with the canvas focused to open a radial menu of separate floating rectangular buttons centered at the pointer
(or the viewport center before a pointer location is available). **Media** opens
the current searchable media picker; **Upload media** opens the OS file picker
directly; **Reference** opens the searchable document picker. The pickers reuse
the mentions menu's quick-access source, paging, icons, and rows. Media accepts
workspace images/videos or local uploads; references create document preview cards.
The full viewport around the center is divided into equal directional slices. Moving into
a slice highlights its button and matching ring arc; clicking anywhere outside the buttons
activates the highlighted slice instead of dismissing the menu. The center remains neutral. Arrow keys or Ctrl+J/K
navigate; Enter selects and Escape closes. Scrolled results
keep the same inset as the menu padding. The media picker includes a dashed drop
area and Add files button for local images/videos.
On touch the Attach button opens a sheet of the same choices, and Media and
Reference open the picker in a second sheet with finger-sized rows; Media has an
Upload media row where a desktop has the drop area.
Uploading asks the device through `pickCanvasMedia`: the photo library in the iOS
app (`pickPhotoLibraryMediaOrFiles`), a file picker everywhere else. The menu
closes as the picker opens, and the picker's input stays in the document until it
answers, so the files arrive although the menu that asked is gone.
Insertion keeps the world position captured when the menu opened, even under
pan/zoom. New embed insertion and preview-to-embed conversion are unavailable.
Existing embeds can be converted to previews in the inspector. Double-click an
existing embed or choose Interact to enter; Done, Escape, or a click elsewhere on
this canvas returns input to the outer canvas. Resizing changes the editor viewport.
The embedded block stays mounted when entering/leaving interaction mode.

Document cards participate in the shared entity-mention reference system. Shared
maps record mention IDs and durable pending removals, scoped by source canvas ID
so copied rooms cannot remove the original canvas's mentions. Concurrently created
mention IDs remain recorded independently. Removing a card retires its mentions
only after the scene deletion and retirement reach SyncService; failures retain
them for retry and reload recovery. Reference bookkeeping is excluded from scene
undo. Tracking follows the shared mention-tracking flag. Mention creation and the
CRDT commit are separate operations, so interruption between them is not transactional.

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


## AI snapshot rendering and measured fitting

`canvas-render.html` mounts a read-only GraphicsSurface with the same
CanvasTextContent/StaticLexical, CSS and text measurer as the live app. It has no
session or persistence host and returns measured DOM text bounds. The worker uses
it for immutable vision reads and asynchronous fitText measurements, then
revalidates targets before its atomic write. Embedded references are explicit
unavailable placeholders. `browser-test/render.playwright.config.ts` runs actual
DOM fitting regressions on desktop and phone viewports.
AI presence renders bounded validated geometry/text with per-target guards;
reduced-motion receivers suppress AI action previews even with other observers.

Precise AI changes use ApplyCanvasEdits: revision-checked CanvasEditor batches
without a nested model. One batch can animate up to three spatial/group lanes;
all lane previews share one dependency guard and one final atomic commit. The
receiver expands validated lane metadata into ordinary smoothed named cursors.
Reduced motion hides transient geometry and avoids presentation delays. The
read-only render surface exposes resetCanvasSnapshot to dispose scene roots and
closures before an isolated warm page is leased to another authorized request.
