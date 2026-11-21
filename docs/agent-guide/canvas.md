# Canvas

An editable canvas with nothing on it shows the Canvas `TutorialPill` (from `features/video-tutorials`) in the middle of the board, once that video is in its catalog. It goes away when the first item is added or a drawing tool is picked, and read-only and embedded canvases never show it.

## Touch navigation

On a phone or tablet, two fingers pan and pinch-zoom the canvas in every tool,
and a two-finger flick glides. Check each tool: start a marquee, a shape, a
pencil stroke, an arrow, an erase or a text box with one finger, then land a
second. The canvas must zoom around the fingers, and nothing the first finger
started may remain: no new item, no changed selection, no undo step, no text
box. Lift one finger and move the other: nothing happens until both are up.
One-finger behavior is unchanged.

## Touch layout

On a phone or tablet the canvas has no floating toolbar or always-open
inspector. Its controls sit above the dock: the zoom level (a sheet with fit,
zoom levels, grid and snapping), undo and redo, the drawing tools, and, with
something selected, **Style**, **Duplicate**, **Delete** and **More**. The
page's **New** button is hidden while a canvas is open. On an upright phone
Rectangle/Ellipse and Arrow/Line/Connector each share a button: tap it again
while it is selected to choose another. **Style** opens the inspector in a
bottom sheet on a phone and toggles the side panel on a tablet. In the phone
sheet Fill and Stroke each list their palette and canvas colours as a row of
swatches, so a colour can be tried with the shape still in view; the swatch
beside the hex field still opens the full picker. **More**, or a
long press on the canvas with Select or Hand, opens the sheet of clipboard,
group, arrange, select-all and delete actions; the long press selects what is
under the finger first, and lifting the finger leaves the sheet open without
pressing the row under it. Pressed on an item that is part of a group, the sheet
also offers **Select inside group**, which selects that item alone (what
Cmd/Ctrl-click does with a mouse). **Attach** opens a sheet with Media, Upload media,
Reference and Artifact: Media and Reference open a
searchable picker in a second
sheet, and Upload media opens the device's photo library or file picker and
places what is chosen at the middle of the view. Check that nothing sits under
the dock or the home indicator, that every button answers a real tap, and that
closing a sheet leaves the selection as it was.

Text made low on the screen is panned up clear of the keyboard as it appears,
and a long line keeps its end in view; the page itself never scrolls and the
header stays put. The keyboard's Done button on a phone, or its hide key on a
tablet, commits the text and leaves it selected with the Select tool (with
Keep tool after drawing on, the Text tool stays and nothing is selected).

**Zoom to fit** in the zoom sheet shows the whole scene between the header and
the bottom chrome, 24px clear of both and of the screen's sides, and left of the
inspector panel when it is open. The same sheet has **Keep tool after
drawing**: switch it on, choose Rectangle once, and each further drag draws
another rectangle instead of selecting the last one. After a pen (an Apple
Pencil, say) has pressed the canvas, drawing is the pen's: one finger under a
drawing tool or the eraser pans instead, and the sheet gains **Draw with pen
only**, which gives drawing back to fingers when switched off. Select, Hand and
Text stay a finger's throughout. A simulator has no pen; check this on a tablet
with one. Turn the device: a canvas nobody has moved since
the fit is fitted again, and one that was moved keeps what was in the middle of
the view in the middle.

Handles are drawn small but a finger takes them from further away: a drag that
starts within 16px of a corner or of the rotation knob, or within 12px outside
an edge, resizes or rotates; a drag from the middle of the shape moves it, a
thin shape (a line of text, a divider) included. A tap
in those places changes nothing: beside the shape it selects what is there or
clears the selection. A selected connector's ends are taken from 16px away too,
by any pointer in the touch view: a drag moves the end by as much as the pointer
moves, and a tap leaves it and its attachment as they were. A tap on empty canvas within 10px of an unfilled shape's
stroke selects it, but a shape under the finger always wins. A press on another
shape is for that shape even right beside the selection. On touch there are no
corner-radius handles; use Corner radius in the inspector. The handles' wider
reach is for fingers only: a mouse on the same canvas hits what is drawn.

## Canvas colors

To check the default canvas color, create a rectangle and a text box without
changing the swatch. The rectangle should have a light neutral fill and a dark
outline; the text should be dark and visible. Also check the neutral swatch after
selecting another color. Neutral colors use an OKLCH `none` hue, which must render
as gray rather than transparent.

## Canvas link paste

Pasting a supported routed Macro app link onto the canvas creates a document
reference card. Routed links retain compatible block targets, but not workspace
paths or pane-local search state; unsupported links remain text.

## Copying and saving images

Select exactly one image to show **Copy image** and **Save image** in both the
context menu and the Canvas inspector. They use the original image, without
canvas transforms or styling. Copy writes image data where supported; the shared
image action can fall back to copying its URL. Save downloads the source format
on desktop and uses the native share sheet on supported mobile devices.
Controls are disabled while resolving the image source or running an action.
Check an uploaded image and a workspace image, and confirm both actions disappear
for multiple selections, groups, videos, and non-image shapes.

## Artifacts

**Insert** offers
**Artifact**, which places a node with starter HTML. The Canvas inspector edits its
title and HTML. The document runs in a sandboxed frame; **Interact** or a
double-click passes pointer input to it, and **Done** or a click elsewhere returns
to the canvas. With the flag off, an artifact shows only its title and no script runs.
The inspector also adds and edits styles and components shared across the canvas;
HTML uses them with `<macro-style name="…">` and `<macro-component name="…">`.
**Present** on a node opens the artifacts full screen in presentation order, which
**Earlier** and **Later** in the inspector change. Check arrow keys and Esc both
before and after clicking inside the frame. For an agent, `ReadCanvas` returns
`artifactGuide` when the flag is on for the user, and artifact SDK operations in
`ApplyCanvasEdits` fail without changing anything when it is off.

## Multiplayer canvas

Open the same canvas as two editors and a viewer. Create/move a shape in one
editor and style it in the other; all three should converge. Undo the move and
confirm the remote styling survives. Check colored cursors, dashed remote
selections and live drag/drawing ghosts, including camera pan/zoom. Text, media,
connectors and document cards use bounds-only ghosts; connector endpoint drafts
are not broadcast. On touch, check selection and gesture awareness without hover.

Disconnect an initialized editor, edit, reopen from its local cache, then reconnect.
The unsent edits must survive and reach the other peers. Disconnecting removes
remote overlays locally; absent peers expire after ten seconds. If the first
connection or local storage fails, the original JSON opens read-only with Retry.
If a live session cannot save locally, keep it open and use Retry saving; the
live scene stays mounted until its buffered edits are persisted. Changing
accounts invalidates the old connection; refreshed view/comment grants disable
canvas edits.
A viewer may wait on the original JSON until the first editor initializes the room.

Downloads export the live scene, and Copy duplicates the shared room plus its
original JSON. Reload older open canvas tabs before collaborating: the previous
whole-file editor does not participate in shared state. Editing the same text
item concurrently chooses one completed content string; characters do not merge.


## AI editing and visual reads

Use **Ask Macro** to attach the live Canvas. Ask for a visual layout or diagram:
Macro can call **RenderCanvas** for an immutable PNG with crop/revision/object
mapping, then edit and visually review the result. Embedded content is explicitly
unavailable in scoped renders. A viewer can read/render but cannot edit.
**ReadCanvas** also offers a compact approximate semantic overview with stable IDs.

For a person mention, type `@` inside a text box or label and select the person.
Ask Macro to insert that same person into another text box: it must resolve the
user ID/email and call `mentionUser`, rather than type literal `@Name`. Inspect
`[data-user-mention]` and its `data-user-id`/`data-email`, reopen the Canvas, and
check a second editor sees the same chip. Existing rich text and other chips
remain intact. Test wrapped text and an ellipse after resizing; chips must fit.
ReadCanvas returns `userMentions` offsets/identities (bounded with an explicit
truncation flag). A concurrent human relabel during measurement rejects the
whole AI batch. Canvas chips do not send notifications or change access.

Watch from a second editor: named AI writers show transient create/move/resize,
connector and label previews, and independent tasks can progress together. These
previews never save partial text. Unrelated edits retain valid previews; changing
a target invalidates its pending batch. Cancel removes uncommitted overlays while
keeping acknowledged prior batches. Reduced motion skips presentation delays.

AI labels keep the requested font and grow boxes at their wrapping width by
default. Check wrapped paragraphs, long unbroken strings, standalone text and
ellipses after relabeling, font changes and narrowing width. Explicit fixed-size
containment may scale text; an explicit overflow error commits no partial batch.
The renderer regressions inspect actual text DOM bounds, including phone viewports.

Create a fresh Canvas manually and through CreateDocument (`canvas`, empty
fileContent). ReadCanvas and EditCanvas must work immediately before any editor
opens it. Open it as its owner and another editor, reload, and verify the same
items persist. Reopen a legacy S3 Canvas and verify its scene migrates without
replacement. Native sync-backed Canvas loading must never request a presigned
blob URL. A missing native snapshot is an error, never an empty reseed.

For precise changes, ask to move the fixed-pivot boxes down 20 units or restyle
specific labels. The main agent should use **ApplyCanvasEdits** with the fresh
ReadCanvas revision and one batch, without screenshots or a second model.
Check the returned geometry and text-layout effects. A stale revision must cause
no mutation; reread before reconsidering the batch. For design tasks, EditCanvas
receives an initial image and reviews its final layout; avoid extra outer renders
of the same revision. A crop cannot verify changed objects outside its bounds.

Watch a single batch affecting three separate regions from a second browser:
up to three named region cursors should animate real operations together, then
one durable commit should appear. Moving a group keeps its descendants together.
A human target edit during any lane cancels the pending whole batch; unrelated
changes survive. Repeat with reduced motion, a phone viewport, cancellation and
reload. Cursor lanes represent operation groups, not extra model calls.

## Mirror-backed tree compatibility

Reopen a native Canvas created before Mirror tree support. Opening it must not
replace its nodes or write a conversion snapshot. In two editor windows, group
and ungroup shapes, move a group, reorder siblings and move children between
groups. Both windows should retain the same IDs, geometry and ordering after
reload. Move a group locally, restyle one child remotely, then undo the local
move: the remote style must remain. Check labels and ellipses after these edits.
Host metadata updates must not cancel a pending scene gesture or add undo steps.
The graphics backend owns the scene Mirror on the existing host sync document;
there is no second scene or separate transport to initialize.
