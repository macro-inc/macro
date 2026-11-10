# Native editing overlay browser checks

This static fixture mounts a real local native session with the same
`installNativeMarkdownOverlays` function used by the document body. It uses the
actual SessionPort, Macro element registry, checkbox hit-test and native actions;
it supplies no Source editor/context or compatibility model.

From `apps/web`, after building that checkout's native document-session WASM:

```sh
bunx playwright test --config src/lib/core/component/LexicalMarkdown/editing/browser-test/playwright.config.ts
```

The configuration owns a static build and preview server and runs Chromium,
Firefox and WebKit desktop plus Chromium tablet/phone touch profiles. Each
`PLAYWRIGHT_<BROWSER>_EXECUTABLE_PATH` may point to a matching owned browser
wrapper. Set `NATIVE_OVERLAYS_PORT`, `NATIVE_OVERLAYS_OUTPUT` and
`NATIVE_OVERLAYS_JSON` to isolate concurrent runs. It never reuses a server.

Checks cover native marker toggles, the tab-index guard, read-only UI, dynamic
Session write revocation while the UI remains editable, exact-once listener
ownership after repeated disposal/remount and native save/reopen with durable
IDs. Actual Source import adds `environmentTags: null` when authored document
metadata omits that field; `metadata-roundtrip.test.ts` independently pins that
Source behavior. The native test retains both raw strings and asserts precisely
that addition, with every other byte/ID unchanged. It does not compare native
compact writer JSON to Source's different export representation or normalize
either snapshot.

The same fixture renders the actual `FocusClickTarget` with the document's
`createNativeFocusTarget` host. It checks the focused-range guard, native
append/reuse policy and resulting typing caret. A real selection-input
completion queues exterior focus through the real SessionExecutor: the host
must wait for command completion and recheck disposal/read-only UI before
calling browser focus. The fixture observes the real focus method and published
DOM; it never fabricates flags, a synchronous executor step or model output.

The fixture seeds a checklist directly. It does not establish slash-menu
creation, task-list filter/progress UI, real document transport/persistence or
the complete document-app mount. Those acceptance checks remain separate.
