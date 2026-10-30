# Canvas

## Canvas colors

To check the default canvas color, create a rectangle and a text box without
changing the swatch. The rectangle should have a light neutral fill and a dark
outline; the text should be dark and visible. Also check the neutral swatch after
selecting another color. Neutral colors use an OKLCH `none` hue, which must render
as gray rather than transparent.

## Canvas link paste

Pasting a supported routed Macro app link onto the canvas creates a text
node with an entity mention, as legacy links do. Routed links retain compatible
block targets, but not workspace paths or pane-local search state; unsupported
links remain text.

## Copying and saving images

Select exactly one image to show **Copy image** and **Save image** in both the
context menu and the Canvas inspector. They use the original image, without
canvas transforms or styling. Copy writes image data where supported; the shared
image action can fall back to copying its URL. Save downloads the source format
on desktop and uses the native share sheet on supported mobile devices.
Controls are disabled while resolving the image source or running an action.
Check an uploaded image and a workspace image, and confirm both actions disappear
for multiple selections, groups, videos, and non-image shapes.

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
