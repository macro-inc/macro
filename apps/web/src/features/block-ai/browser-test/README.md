# Illustrator editor browser fixture

This entry mounts the real `AiEditorView` with the wasm engine in its
workers. It loads no authentication, document storage, or product routes,
so it verifies the editor and engine integration, not storage or
permissions.

From `apps/web` (build the engine first with `just ensure-ai-engine-wasm`):

```sh
bunx vite --config src/features/block-ai/browser-test/vite.config.ts
```

Open `http://127.0.0.1:3021/?sample`. The documents:

- `?new`: a blank document, as the create menu makes it (one 1920 × 1080
  artboard);
- `?sample`: `sample-document.ts`, built with the engine: an 800 × 600
  artboard with a red rectangle, a blue circle with a black outline, and
  the text "Hello" on "Layer 1", and an empty layer "Notes" above;
- `?file=<name>`: a file from the directory named by `AI_CORPUS_DIR` (with
  a trailing slash), such as a folder of Illustrator samples. The header
  also opens a local `.ai`.

Saves stay in memory (`?reload` reopens each one, checking it
round-trips), and `?readonly` opens the document as a viewer would.
Test-only `window.aiFixture`:

- `engine()`: the open `AiEngine` (queries, renders, edits);
- `errors()` / `notices()`: messages the editor reported;
- `downloads()`: names and sizes of exported files;
- `saves()`: every saved `.ai`, oldest first, and `rowsOf(bytes)`, the
  layers panel's rows of a file opened on its own;
- `fontRequests()`: font stylesheets and files the editor fetched. The
  Figma fixture's font source stands in for Google Fonts (every family is
  served as the bundled Inter), so the tests need no network.

`?collab` (with `&people=alice,bob`, the default, and `&sample` or `&file=`)
opens several people on one document side by side, each with the real
shared-document session (Loro document, WAL, awareness), engine, and
editor, connected through the Figma fixture's in-page sync server
(`block-fig/browser-test/memory-sync.ts`), which also holds the stored
file. `window.aiFixture.collab.people()` exposes each person's `engine()`,
`session()` (their id session), `saves()`, `status()`, and `peers()`;
`storeOutside()`, `reopen(name)`, `setReachable(bool)`, and `stored()`
replace the stored file, reopen a person, take the server down, and read
the stored file.

Run the browser regressions (the configuration starts or reuses the
fixture; `AI_BROWSER_PORT` picks another port than 3021 for both):

```sh
bunx playwright test --config src/features/block-ai/browser-test/playwright.config.ts
```

`ai-editor` covers opening a new document and the sample, selecting
(click, ⇧-click, marquee), drawing shapes and lines, moving, nudging,
scaling with the bounding box, ⌥-drag copies, undo and redo, editing and
making text, the layers panel (hide, lock, rename, new layer, drag to
restack), grouping, arranging, copy, paste, duplicate, direct selection,
the pen, artboards, outline view, zoom shortcuts, panning with Space,
wheel and zoom-tool zooming, exports, saving (renames included), and
read-only access. `ai-panels` covers the properties panel (fill, stroke,
joins, opacity, size, rotation), the toolbar swatches, the eyedropper,
align and the pathfinder, clipping masks, create outlines, select all,
text settings, switching fonts (loaded first), polygons and stars,
rotating, dragging into another layer, expanding, coloring, and deleting
in the layers panel, and pasting an image. `ai-collaboration` covers
edits, undo, pointers, and avatars reaching the other person, both
people's objects on both sides, a file stored outside the session, and an
unreachable sync service.

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when the bundled browser is not
installed. Failure traces and screenshots stay in the ignored
`test-results/` folder.
