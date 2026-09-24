# Canvas Next — A1/A2

Open `/app/component/canvas-next` in local development. `USE_CANVAS_NEXT` is an
env-only flag enabled by default with Vite HMR. Set `VITE_USE_CANVAS_NEXT=false`
to hide the demo. The additional `LOCAL_ONLY` guard prevents an env override from
enabling it in deployed bundles.

This is a new composition inside `block-canvas`, using `@macro-inc/graphics`.
It does not use legacy Canvas state, Zod, document saving, or local storage.
`core/seed-scene.ts` supplies disposable data; reload or Reset demo starts fresh.
The older demos remain focused regression fixtures. Actual Canvas documents still
use the existing document host until the production gate in `docs/GRAPHICS_PARITY.md`.

## Editing

| Action | Shortcut |
| --- | --- |
| Select / rectangle / ellipse / hand | V / R / O / H |
| Temporary pan | Hold Space, or middle-button drag |
| Add/remove selection | Shift-click; Shift-drag adds a marquee |
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
Clipboard toolbar/context actions use the browser clipboard API and report denied
access. Fragments include whole selected subtrees, fresh IDs on insertion, stable
relative order and world placement. Pasting repeatedly offsets by another 24 units.
Only the Canvas Next fragment format is supported; images, text, legacy Canvas and
Excalidraw clipboard formats are later adapters.

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
scaling also scales these dimensions.
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
