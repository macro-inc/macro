# Figma viewer browser fixture

This entry mounts the real `FigViewer` with the wasm engine in its workers,
over `.fig` files from `crates/fig_engine/tests/fixtures` (or any directory
named by `FIG_CORPUS_DIR`). It loads no authentication, document storage, or
product routes. It verifies the viewer and engine integration, not storage or
permissions.

From `apps/web` (build the engine first with `just ensure-fig-engine-wasm`):

```sh
bunx vite --config src/features/block-fig/browser-test/vite.config.ts
```

Open `http://127.0.0.1:3019/?file=showcase.fig`. The header also opens a
local `.fig`. `?edit` makes the file editable and `?new` opens a blank
design; saves stay in memory, and `?reload` reopens each one. Test-only
`window.figFixture`:

- `engine()`: the open `FigEngine` (queries, renders);
- `errors()` / `notices()`: messages the viewer reported;
- `downloads()`: names and sizes of exported files;
- `saves()`: every saved `.fig`, oldest first;
- `fontRequests()`: font stylesheets and files the viewer fetched. The
  fixture stands in for Google Fonts and this computer's fonts
  (`font-source.ts`): every family is served as the bundled Inter, and
  "Nowhere Grotesk" is installed locally;
- `comments`: the in-memory comment store (`memory-comments.ts`, the
  `FigCommentStore` contract the app fulfils with document discussions):
  `threads()`, `arrive(author, text, target)` (someone else comments or
  replies), `notified()` (mentions that would notify), and `people`.

`?present=<frame id>` opens presenting that frame, as a copied frame link
does.

Run the browser regressions (the configuration starts or reuses the fixture;
`FIG_BROWSER_PORT` picks another port than 3019 for both, so checkouts running
side by side do not share a server):

```sh
bunx playwright test --config src/features/block-fig/browser-test/playwright.config.ts
```

They cover rendering, the layers and pages lists, Figma's selection rules
(top-level frames select their child, double-click into instances), Escape,
frame and page navigation, zoom shortcuts, export, the shortcuts dialog,
and editing: drawing, moving, and saving shapes, lines and arrows, fills
and shadows from the design panel with undo and redo, typing and styling
text, auto layout (adding it, gap and padding, sizing, drag to reorder),
constraints, resizing several layers and rotating one, components
(creating, placing instances from Assets, overriding their layers,
detaching), adding pages, and read-only access. `fig-shapes` covers
boolean operations and flattening, drawing with the pen and editing
points, SVG export (compared with the PNG) and Copy as SVG, and copying
layers into another file through the system clipboard. `fig-shortcuts`
covers the pencil (⇧P), the design palette (⌘P, which never prints), ⌘. for
the UI, aligning and distributing, opacity digits, and swapping fill and
stroke. `fig-design-ui` covers
the right-click menus, the color and paint pickers (gradients, dashes,
reordering paints), mixed values for several layers, and the layers
panel's range selection and arrow keys. `text-editing` covers the caret
and selection drawn from the engine's layout, word and paragraph
selection, line moves, styling a range (⌘B/⌘U, the panel), undo in typing
bursts, switching fonts, and the missing fonts notice. `fig-design-system` opens
`design-system.fig` (components with boolean, text, and instance swap
properties, a component set, and color, text, and effect styles in use,
made by `fig_engine::testing::design_system`) and covers instance
properties, variant switching, swapping and resetting instances, editing
a component set's variants and properties, binding layers to properties,
and applying, creating, renaming, and detaching styles; on `variables.fig`
(a collection with Light and Dark modes) it lists variables, binds fill
colors to them, and switches a frame's mode. `fig-handoff` covers export
presets (adding, editing, saving, a ZIP of several and a single file, the
preview), Export frames to PDF, Dev Mode inspect and its code languages and
assets, layout grids (adding columns, drawing, ⌃G, snapping, saving), and
ruler guides (dragging from a ruler, snapping, deleting). `fig-review` opens
`prototype.fig` (a flow with navigate, dissolve and slide transitions, an
overlay, Back, Close, a link, and a legacy connection, made by
`fig_engine::testing::prototype_file`) and covers presenting (flow order,
the arrow keys, the selected frame, copying a frame link and opening it),
clicking through the prototype (hotspot hints, overlays closing on a click
outside), editing interactions and flows in the Prototype tab (with the
connection noodles, undo, and saving), and comments (placing one on a
frame, @mentions, replies, unread badges, resolving and reopening, and the
pin following its frame).

`?libraries` keeps two designs in memory, "Design system"
(`design-system.fig`, or `&library=<file>`) and a blank "App", with the
header switching between them (saves replace the stored design, as document
storage does), each with the other as a possible team library
(`memory-libraries.ts`, the `FigLibrarySource` contract the app fulfils
with document storage); `window.figFixture.libraries` has `open(id)`,
`current()`, and `reads(id)`. `fig-libraries.browser.e2e.ts` publishes the
library, enables it in App, places a component (by click and by drag) and
applies a style from it, changes and republishes the library, and updates
App's copy, keeping the instance.

`?collab` opens several people on one design side by side
(`&people=alice,bob` by default), each with the real shared-design session
(Loro document, WAL, awareness), engine, and viewer, connected through an
in-page sync server (`memory-sync.ts`, the `LiveSyncSource` contract the sync
service's transport implements), which also holds the stored file;
`window.figFixture.collab.people()` exposes each person's engine, saves,
status, and peers, and `storeOutside()`, `reopen(name)`, and
`setReachable(bool)` replace the stored file, reopen a person, and take the
server down. `collaboration.browser.e2e.ts` covers edits and undo reaching
the other person, remote pointers, selections and avatars, one person
storing the merged file, following someone's view, a file stored outside
the session, and an unreachable sync service.

`FIG_CORPUS_DIR` (with a trailing slash) serves another directory of
files; `--port` runs a second server beside the default one.
Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when the bundled browser is not
installed. Failure traces and screenshots stay in the ignored `test-results/`
folder.
