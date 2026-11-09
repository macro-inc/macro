# Android editor host

The Android library hosts the shared Rust session in an AppCompatEditText. Its
InputConnection owns platform IME input, selection handles and accessibility text;
`document_session_ffi` owns document changes, history and synchronization policy.

`EditorProjection` retains keyed view state and maps UTF-16 positions. A native
text edit may elide its entire Rust text diff: update the view cache from that edit
before applying model corrections. Read type names from the session type table,
not node properties, because the structural diff removes base metadata.

Use the shared insertion-policy query before choosing a text splice: changed
typing marks and token boundaries require an insertion command. Reattach a
running session with `attachRunningSession` to restore text and selection while
retaining its existing history and synchronization lifecycle.

`NativeEditorHost.execute` receives ordered typed effects after the Rust call
returns. A host executor must return correlated storage completions only after
real transactions commit, preserve transport generations, schedule the session's
single timer, and forward telemetry. The view itself does not execute storage or
network requests. `EditorMount` handles viewport placement and clipping; its owner
must drain Stop before destroying the session.

Application adoption requires native menu/search adapters, complete decorators
and block interactions, durable sync and old-draft handoff, and parity across all
existing surfaces. Keep the application feature-flag admission unchanged until
that acceptance is complete.

## Build and validation

Use the Android-capable Rust toolchain, Java 21, SDK Platform/Build Tools 36 and
NDK 30 described in [Android development](../../../../docs/development/android.md).
Run from the repository root. Generate the matching host library and bindings:

```sh
nix develop --command bun crates/client/document_session_ffi/scripts/generate-bindings.ts
```

Run JVM/Robolectric tests and compile instrumentation:

```sh
apps/web/tauri/src-tauri/gen/android/gradlew \
  -p apps/web/tauri/native_editor_plugin/android --max-workers=4 \
  testDebugUnitTest assembleDebugAndroidTest
```

For a runnable emulator instrumentation APK, add
`-PnativeSessionTarget=x86_64-linux-android`; it builds and packages the actual
Rust library. ARM64 uses `aarch64-linux-android`. Native builds are limited to
two Cargo jobs. The host-library test path includes the compiler host triple,
matching binding generation; an Android target directory cannot stand in for it.

`connectedDebugAndroidTest` exercises the same real-session input scenario on a
device. Compiling its APK does not establish device or IME acceptance.
