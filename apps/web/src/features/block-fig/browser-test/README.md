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
- `saves()`: every saved `.fig`, oldest first.

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
detaching), adding pages, and read-only access.

`FIG_CORPUS_DIR` (with a trailing slash) serves another directory of
files; `--port` runs a second server beside the default one.
Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when the bundled browser is not
installed. Failure traces and screenshots stay in the ignored `test-results/`
folder.
