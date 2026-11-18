# Media decorator parity

## Current canonical package

This fixture now imports the canonical ordinary document-session package built
by `just build-document-session-wasm` in `apps/web`. It does not load a private
`wasm/` or `wasm-root-id/` directory. Before a new run, build that package, run
`bun scripts/check-decorator-browser-wasm.ts`, then typecheck with
`bun ../../node_modules/typescript-native/bin/tsc --noEmit --skipLibCheck --project tsconfig.decorator-browser-tests.json`.
The current Playwright config requires the real outputs, checks their declaration
against the generated consumer ABI, and records their actual hashes in metadata.
A missing output or mismatched declaration fails; there is no stub or skip.

## Archived build evidence

Earlier manifests, seal-specific descriptions and captured evidence describe
the archived builds, not this canonical target. Reproduce those runs only with
their archived fixture source and matching artifacts. They do not qualify a new
canonical-package run, and the typecheck change supplies no new browser result.

The fixture loads the real Source and native editor surfaces from the same
Source export. It compares literal model JSON, editor markup and shadow
markup. It also checks selection, cached setters, Portal lifetime and toolbar removal.
The browser intercepts only the synthetic image response and unrelated app
service requests.

Run the three Playwright projects with the matching generated native package
under `wasm/`. The config verifies the sealed manifest and every package file.
Use `IMAGE_SOURCE_ONLY=1` for the Source preimage capture and keep those raw
captures for comparison against the Source host change. The test records the
compiled Source dependency witnesses alongside each raw capture.

The original 50ce paired trace covers a remote URL and toolbar removal. The
image and video upload cases use a browser File, the existing app provider and the a899
artifact containing both native media guards. The loopback receiver holds
the actual PUT response until the test has observed progress. The raw traces
retain each browser-generated preview URL and node ID. Compare the exact
request bytes, local preview retention, and each persisted outcome without
rewriting either trace.

Media hosts observe kind-scoped upload events from the surface's IO owner. A stored
local URL alone does not signal an in-flight upload.

The video case uses the same-origin WebM fixture and waits for actual decode
and playback controls. A Linux WebKit runner needs GStreamer WebM demux and
VP8 decode plugins. It dispatches a DOM click to the shared decorator
handler because browser playback widgets can consume pointer clicks. The
toolbar removal still uses a pointer click. Both engines must retain the
same Portal host through the cached URL setter and subsequent remount.

The clipboard case feeds a browser DataTransfer into the native clipboard
pipeline and compares its provider outcome with Source's real file picker.
It covers the native file intent and IO callback. It does not claim OS
clipboard parity. Chromium and WebKit also passed the separate paired
constructed-ClipboardEvent trace. Firefox's Source trace handled that
constructed event without delivering its file, and that failed trace is
retained separately.

The media picker case opens the real Source command and native upload-controller
file dialogs, selects both file kinds, and moves the model selection while the
chooser is open. It checks actual provider PUT bytes, completion and preview
retention in each arm. Separate lifecycle controls cancel the picker, change local
editability before selection, and dispose its owner. These tests use browser
filechooser automation; they do not exercise an operating-system picker UI.
