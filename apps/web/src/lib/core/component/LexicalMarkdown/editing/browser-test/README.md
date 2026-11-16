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

The installer also owns body list swipes, block-gap clicks and table long presses.
Trusted Chromium phone/tablet touch checks indent/outdent and listener disposal,
remount and read-only admission in `list-swipe.browser.e2e.ts`. Native list policy
keeps nested descendants with their parent; the adapter supplies gesture geometry
and uses current session-edit admission. Its required
`canEdit` accessor comes from the document host; it does not infer reactive
permission from DOM attributes. The gap fixture loads actual Source-produced
code JSON and clears real native history after loading, then checks insertion,
typing and exact model undo/redo. Retain loading in history only when testing
loading itself. Trusted Chromium touch on tablet and phone checks single-cell
selection and extension after the real long-press timer. This does not establish
the table action bar's merge/split or clipboard behavior.

Installer and gesture listener scopes release all completed registrations after
partial failure, preserve the original opaque cause, and make disposal
idempotent. Unit fault controls use real native sessions and actual DOM listener
registrations; browser controls exercise normal mounted ownership. Static builds
emit source maps so the exact compiled Source dependency bytes can be checked.

The fixture seeds a checklist directly. It does not establish slash-menu
creation, task-list filter/progress UI, real document transport/persistence or
the complete document-app mount. Those acceptance checks remain separate.


`user-mentions.html` exercises the first native USER mention stage with the
actual shared HostedMentionsMenu, real user decorator and settled SessionPort
input. The Source branch uses its real editor, plugins and public wrapper.
Both receive the same supplied user records and geometry. Controls retain raw
menu DOM and model snapshots, type `@`, filter, pick with keyboard/pointer/touch,
close with the shared Escape controller, and dispose visible UI and listeners.
These supplied-user checks do not establish service discovery, tracking delivery,
other mention kinds or installed-app acceptance. The final native catalog must
retain every Source section, condition and mobile ordering.


The hosted fixture mode uses the actual `createRustEditorSession` app factory.
It installs before the first projection, supplies a genuine optimistic seed,
waits for durable seed arbitration and full reconciliation, then observes actual
settled authoring. Controls distinguish absent generation from a malformed real
query reply, including deferred failure and disposal before first projection.
A failed optional menu must leave ordinary document editing available.

This suite selects the supported same-origin backend configuration. User profile
pictures receive a local `{pictures: []}` response. Only the analytics transport
URLs in the actual providers module are rewritten: Google tag/manager scripts,
Meta events and the pixel image load emitted local static assets. The real
analytics and menu providers remain mounted; analytics delivery is outside this
cohort. Every other external HTTP/WebSocket attempt is aborted and fails the
USER fixture, including production hosts. Record these rewrites with evidence.


## Word navigation

`word-navigation.playwright.config.ts` runs the existing actual user-mention
fixture with Source and native engines on Chromium desktop, tablet and phone.
It inserts a mention through the menu, admits an initial browser caret through
selectionchange, then compares trusted Ctrl+Left/Right and subsequent typing.
Raw model JSON, DOM points and the served WASM hash are attached separately.
The command/model controls cover Shift, code endpoints and simulated Apple
line-edge fallback; this browser gate does not claim physical Apple or Firefox.

Use `NATIVE_WORD_OUTPUT` for an isolated cache, build and report directory and
`NATIVE_WORD_PORT` for the preview port. The served WASM must match the canonical
ordinary artifact, or the explicit `NATIVE_WORD_WASM_SHA` when supplied.
`NATIVE_WORD_PREBUILT=true` with `NATIVE_WORD_BUILD` replays a previously sealed
static build; verify its source and package-map hashes before attributing the
result to current code.

`native-emoji-and-format.browser.e2e.ts` loads `user-mentions.html?engine=native&emoji=1`
to check the native `:` picker (Enter and closing-shortcode insertion) and the Macro
Control/Meta+E, +Shift+X and +Shift+H format shortcuts. The mention fixture's Source
side uses the Source body menu's default sources, as the native overlay does.
