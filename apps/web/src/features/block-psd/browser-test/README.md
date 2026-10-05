# Photoshop editor browser fixture

This entry mounts the real `PsdEditor` with the wasm engine in its worker.
It loads no authentication, document storage, or product routes, so it
verifies the editor and engine together, not storage or permissions.

From `apps/web` (build the engine first with `just ensure-psd-engine-wasm`):

```sh
bunx vite --config src/features/block-psd/browser-test/vite.config.ts
```

Open `http://127.0.0.1:3020/?new` for a new 1920 × 1080 document
(`&size=800x600` for another size). `?file=<path>` opens a file from the
directory `PSD_CORPUS_DIR` names (with a trailing slash; no Photoshop files
are committed), and the header opens a local `.psd` or `.psb`. `?readonly`
opens it for a viewer, and `?reload` reopens every save in a second engine
to check that it round-trips. Saves stay in memory. Test-only
`window.psdFixture`:

- `engine()`: the open `PsdEngine` (queries, renders);
- `saves()`: every saved file, oldest first;
- `downloads()`: names and sizes of exported files;
- `errors()` / `notices()`: messages the editor reported.

`?collab` opens several people on one document side by side
(`&people=alice,bob` by default; a new document of `size`, or `&file=`),
each with the real shared-document session (Loro document, WAL,
awareness), engine, sharing, and editor, connected through an in-page sync
server (the Figma fixture's `memory-sync.ts`, which implements the
`LiveSyncSource` contract the sync service's transport does) that also
holds the stored file. `window.psdFixture.collab.people()` exposes each
person's engine, saves, status, peers, and errors; `storeOutside()`,
`reopen(name)`, and `setReachable(bool)` replace the stored file, reopen a
person, and take the server down.

Run the browser regressions (the configuration starts or reuses the
fixture; `PSD_BROWSER_PORT` picks another port than 3020 for both, so
checkouts running side by side do not share a server):

```sh
bunx playwright test --config src/features/block-psd/browser-test/playwright.config.ts
```

`psd-editor.browser.e2e.ts` opens a new document, paints a brush stroke,
adds a layer, fills a selection and moves it with undo and redo, types text
and edits it again (the layer named after its text, one undo step for the
typing), saves (and reopens the saved file), zooms with the keyboard, and
opens read-only. `collaboration.browser.e2e.ts` covers a stroke, a new
layer, and undo reaching the other person, their pointer and avatar, one
person storing the merged file, and someone reopening the document after
edits.

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when the bundled browser is not
installed. Failure traces and screenshots stay in the ignored
`test-results/` folder.
