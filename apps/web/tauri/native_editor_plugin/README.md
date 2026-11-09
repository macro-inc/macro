# Android editor host

The Android library hosts the shared Rust session in an AppCompatEditText. Its
InputConnection owns platform IME input, selection handles and accessibility text;
`document_session_ffi` owns document changes, history and synchronization policy.

The Android Tauri plugin exposes generated lifecycle, layout, permission,
application-action and query requests. `NativeEditorSurfaces` issues account
generations, retains retired surface generations, and rejects stale scope or
model/revision results. Input connections and detached-view callbacks cannot
resume after their view or permission generation changes. Mount, placement,
focus and unmount carry a separate mount generation; session scope alone cannot
identify a replacement view. Unmount clears pending placement/focus configuration,
including before model initialization. Registration does not
change the application's existing editor admission.

`EditorProjection` retains keyed view state and maps UTF-16 positions. A native
text edit may elide its entire Rust text diff: update the view cache from that edit
before applying model corrections. Read type names from the session type table,
not node properties, because the structural diff removes base metadata.

Use the shared insertion-policy query before choosing a text splice: changed
typing marks and token boundaries require an insertion command. Reattach a
running session with `attachRunningSession` to restore text and selection while
retaining its existing history and synchronization lifecycle.
Route ordinary native Enter and physical Shift+Enter through the shared model
key command before applying Android defaults; heading splits and line breaks
must use the application policy.
Pass editor editability and content-interaction permission separately. A content
lock revokes input, paste, formatting and undo entry points without representing
comment capability; the shared session continues to authorize comment commands.

`NativeSessionHost` owns session lifetime beyond a mounted view, queues callback
admissions on the main thread, maintains one deadline timer, and releases the
session after the core confirms Stop. It dispatches typed `NativeSessionEffects`
to application adapters. These must return storage completions only after
real transactions commit, preserve transport generations and forward telemetry.
The view itself does not execute storage or
network requests. Render failures cannot discard I/O effects. `EditorMount` handles viewport placement and clipping; its owner
must drain Stop before destroying the session.

`EditorClipboard` exports Android's standard HTML/plain pair and retains the
shared model's internal-node and Markdown strings in app-owned clip metadata.
Native-to-native paste imports that structured payload through the shared node
registry, retaining marks and Unicode selections. Explicit plain paste supplies
the shared typed paste facts so the application Markdown importer leaves it literal. Other applications continue
to receive standard text/HTML. General external HTML conversion and file paste
remain separate host adapters.

`NativeSessionStorage` executes the typed storage operations in private SQLite
with full synchronization, idempotent WAL keys and atomic adoption/pruning.
Hold its OS owner lease until pending storage work has drained. Run it on a
storage worker; its successful result follows transaction completion. Live
foreign owners are read-only assist sources, and adoption validates the loaded
rows and current snapshot coverage before changing anything. Its database is
separate from the WebView stores; application adoption still needs explicit
old-draft handoff.
Wait for initial durable loading before offering an empty optimistic seed, so
first-wins initialization can prefer the local snapshot. Snapshot scheduling
continues to use the shared session policy and supplied clock.

`NativeSessionAdapters` runs storage on a serial worker and uses the application's
OkHttp client, token source, socket request factory, peer supplier and telemetry
sink. It forwards binary frames unchanged and sends the same application-level
`ping` heartbeat as the web executor. Each callback retains its connection or
session lifetime; closing cancels owned sockets/token requests and drains queued
storage before releasing its lease. Reconnect, protocol and authorization policy
remain in Rust. Runtime account/endpoint wiring is still required at adoption.

Application adoption requires native menu/search adapters, complete decorators
and block interactions, durable sync and old-draft handoff, and parity across all
existing surfaces. Keep the application feature-flag admission unchanged until
that acceptance is complete.
The UI action bridge requires content interaction; background provider results
and comment publication need their own correlated adapters. Preserve both legacy
draft-wrapper save/sync stripping and the modern cursor-based draft protocol in
[LocalCommentDraft](../../src/features/block-md/comments/LocalCommentDraft.tsx)
and [message comment operations](../../src/features/block-md/comments/messageCommentOperations.ts):
publication awaits the anchor acknowledgement, rechecks identity after awaits,
and retains uncertain potentially posted anchors.

## Build and validation

Use the Android-capable Rust toolchain, Java 21, SDK Platform/Build Tools 36 and
NDK 30 described in [Android development](../../../../docs/development/android.md).
Run from the repository root. Generate the matching host library and bindings:

```sh
nix develop --command bun crates/client/document_session_ffi/scripts/generate-bindings.ts
```

Run JVM/Robolectric tests and compile instrumentation:

```sh
bun apps/web/tauri/native_editor_plugin/scripts/android-check.ts
```

For a runnable emulator instrumentation APK, add
`-PnativeSessionTarget=x86_64-linux-android`; it builds and packages the actual
Rust library. ARM64 uses `aarch64-linux-android`. Native builds are limited to
two Cargo jobs. The host-library test path includes the compiler host triple,
matching binding generation; an Android target directory cannot stand in for it.
The helper resolves the pinned Tauri Android project through Cargo metadata.
Use root-qualified Gradle tasks such as `:testDebugUnitTest` when passing filters,
so a filter for editor tests is not applied to Tauri's own test project.
App builds package the same target list and build profile as the Tauri build;
standalone builds package a device library only when explicitly selected.

`connectedDebugAndroidTest` exercises the same real-session input scenario on a
device. Compiling its APK does not establish device or IME acceptance.

Bridge records for all three languages are generated from `schema/bridge.schema.json`.
Install the private generator
dependencies and regenerate or check freshness from the repository root:

```sh
bun install --cwd apps/web/tauri/native_editor_plugin --frozen-lockfile --ignore-scripts
nix develop --command bun apps/web/tauri/native_editor_plugin/scripts/generate-bridge.ts --check
```

The instrumentation APK also contains a standalone real-session test window.
After building with `-PnativeSessionTarget` and installing that test APK, open it:

```sh
adb shell am start -n com.macro.editor.test/com.macro.editor.NativeEditorTestActivity
```

It uses a memory session without an account, network or durable data.
`NativeEditorWindowTest` drives the real window through accessibility text input
and physical Undo/Redo, checking both displayed text and the Rust history state.
Compile-only checks do not establish these device interactions or IME acceptance.
This activity exists only in the test APK and does not select app editing surfaces.
