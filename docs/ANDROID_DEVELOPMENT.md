# Android development

Macro's Android package is `com.macro.app.prod`. Its Gradle project lives in
`apps/web/tauri/src-tauri/gen/android`. Keep the project and wrapper in source
control; do not regenerate them to repair a build error.

## Prerequisites

- Use the repository's Bun version (`packageManager` in the root `package.json`)
  or a compatible newer version, and confirm `bun --version` in the shell that
  will run the build. Run `bun install --frozen-lockfile` from the repository root.
  Older Bun installations can fail to resolve workspace `catalog:` dependencies.
- Install the Rust toolchain in `rust-toolchain.toml`, `just`, `wasm-pack`, and
  the Tauri CLI (`cargo tauri`).
- Install Android SDK Platform **36**, Build Tools 36, Platform Tools, and an
  Android 16 / API 36 Google Play ARM64 emulator through Android Studio.
- Install NDK **30.0.16248370**, or set `NDK_HOME` to another intended installed NDK.
- Use Java **21**. The launcher detects Homebrew's `openjdk@21` on Apple Silicon;
  otherwise set `JAVA_HOME`. Android Studio's bundled Java may be too new for Gradle.
- Run `rustup target add aarch64-linux-android`, boot an emulator, and confirm
  `adb devices -l` lists it as `device`.

The launcher uses `ANDROID_HOME` (default `~/Library/Android/sdk` on macOS,
`~/Android/Sdk` on Linux), `NDK_HOME`, and `JAVA_HOME` without editing shell profiles.

## Development and builds

From `apps/web`, using an available frontend port:

```sh
PORT=3004 just android-dev
just android-build --debug --apk true --aab false
just android-build --apk true --aab true
```

Development uses the deployed **dev** backend, builds required WebAssembly assets,
installs the debug APK, and disables automatic OTA updates. Treat dev data as real.
Stop the command before starting another native build in this worktree. Additional
Tauri arguments can select a device or disable watching, e.g. `--no-watch`.

If ADB reconnects and drops the development-server tunnel, an Android emulator
can reach the host directly at `10.0.2.2`. Use the same port in both places:

```sh
PORT=3004 just android-dev --no-watch --no-dev-server-wait --config '{"build":{"devUrl":"http://10.0.2.2:3004"}}'
```

That address is emulator-only; the host-side server check must be skipped.

Build commands embed the production frontend. Outputs are under
`tauri/src-tauri/gen/android/app/build/outputs/`. The launcher defaults to ARM64.
Release builds require the signing configuration below and produce signed artifacts.

## Release signing

Obtain the existing upload keystore and signing credentials from the release
maintainers. Keep them outside the checkout and provision them securely for CI.
Coordinate key replacement with Play Console; do not generate a new key for
routine builds.

Gradle reads ignored `tauri/src-tauri/gen/android/keystore.properties`:

```properties
storeFile=/absolute/path/upload-keystore.jks
storePassword=YOUR_KEYSTORE_PASSWORD
keyAlias=upload
keyPassword=YOUR_KEY_PASSWORD
```

Restrict the directory to its owner and the keystore/properties files to mode
`0600`. The properties file can be a symlink to an owner-only file outside the
checkout. For CI, provision these files from the secret manager before building.
Missing signing configuration fails a release build; debug builds retain their
normal debug certificate. No signing secrets belong in Gradle source or logs.

For local qualification of the embedded frontend, disable OTA updates:

```sh
just android-build --apk true --aab true -- --no-default-features
```

This still uses production services/Firebase, release optimization, and R8.
Use a separate emulator for this APK: its certificate differs from the debug
APK, so it cannot update the existing debug installation. Do not uninstall a
signed-in development app just to install the release build.

Verify APK signatures with SDK `apksigner verify --verbose --print-certs`, AAB
signatures with JDK `jarsigner -verify`, and APK native-library alignment with
`zipalign -c -P 16 4`. Exercise startup, auth, links, and force-stop/relaunch on
the installed release. OTA-enabled builds and Play-installed upgrades require
their own qualification; passing this local check does not prove those paths.

The upload certificate identifies locally signed artifacts. When Google creates
the Play App Signing key, Play-delivered APKs use that separate certificate; add
its fingerprint to production associations before testing Play-installed links.

## Firebase

Debug builds work without Firebase configuration for auth/navigation development.
Remote notifications require the matching Firebase configuration and Google Play
services on the device. Notification permission alone does not register the
device: sign in to Macro and enable notifications in Settings. Android 13 and
newer show a runtime permission prompt; older versions use the app's system
notification setting. The **Activity** channel can also be disabled separately.

The Android push plugin receives data-only FCM messages and owns their display,
replacement, and clearing. Taps are saved until the authenticated frontend can
receive them. Logout disables the native receiver and clears its saved display
and tap state before attempting network unregistration. The receiver checks the
payload's recipient against the registered account to reject delayed pushes
from an earlier session.

For verification, test foreground, background, and ordinary process death
separately. Background the app, then use `adb shell am kill com.macro.app.prod`
for the process-dead case. Android force-stop is a different state that prevents
FCM delivery until the user opens the app again. Also test permission and channel
revocation, logout/account switching, repeated delivery, notification taps, and
read/done clearing. Silent clearing uses normal-priority FCM and may be delayed
by Doze. A local display test alone does not verify backend event delivery.

The launcher requires package **com.macro.app.prod** and validates these projects:

| Build command | Firebase project |
| --- | --- |
| `android-dev` | `macro-app-dev-12ae0` |
| `android-build` (including `--debug`) | `macro-app-955f1` |

Download `google-services.json` for that package from the matching Firebase
project's settings. Keep local copies in ignored
`tauri/src-tauri/firebase/dev/google-services.json` and
`tauri/src-tauri/firebase/prod/google-services.json`; the launcher selects the
matching file automatically. Alternatively, inject a downloaded configuration:

```sh
just android-dev --firebase-config /absolute/path/google-services.json
just android-build --firebase-config /absolute/path/google-services.json
```

The launcher validates both the package and Firebase project before copying the
file to ignored `gen/android/app/google-services.json`. It also validates an
existing destination when no source is supplied, so switching build modes cannot
silently reuse the wrong environment. Do not commit these files. Release builds
fail with an explicit error if configuration is absent.

## Browser authentication

Android uses `android_auth_plugin` and AndroidX Auth Tab, with a Custom Tabs
fallback. Each attempt creates `macro://android-auth/<random UUID>` before the
backend creates OAuth state. The receiver checks the exact authority/path;
mismatched callbacks leave the active attempt pending. Duplicate parameters are
rejected. The Custom Tabs fallback returns to the task that owns the invocation.
Canceling settles the request so another attempt can start. Never log callback
URLs or session codes.
Android navigation uses `macro://app/<route>`; its MainActivity filter is scoped
to host `app` so older browsers send `macro://android-auth/...` exclusively to
the authentication receiver, without an activity chooser.

Login redeems a one-time code using the existing native HTTP cookie jar.
Gmail/calendar/GitHub linking completes server-side and refreshes queries without
replacing the Macro session. After process death mid-flow, restart authentication;
orphaned callbacks must not silently log in the replacement process. Macro logout
does not sign out of Google/GitHub in the system browser.

iOS retains its existing auth/keyboard plugins. Android uses `android_mobile_plugin`
for live window/IME insets, committed system Back, content-URI sharing, clipboard
images, and file export; it does not build the old keyboard scaffold.

## Input, navigation, and files

The Android mobile plugin publishes window insets from the native WebView. The
WebView keeps its full edge-to-edge size under the keyboard, as on iOS: resizing it
made Chromium relayout the whole document on top of the CSS work. Instead the
plugin publishes the keyboard height and JS shrinks the layout root through
`--dvh` and lifts fixed sheets by `--virtual-keyboard-height`, so nothing subtracts
the keyboard twice. Native density can change before Chromium updates its CSS
viewport, so insets are scaled by the WebView width (which the keyboard never
changes) and re-applied on WebView resize as well as native inset events. Every
root custom-property write recalculates style for the whole document, so only
changed values are written.
System bars and cutouts remain separate safe-area values; floating keyboards with
no bottom inset do not consume viewport height. Insets refresh after layout,
rotation, and resume. Font scale, density, layout direction, and navigation-mode
changes are handled in the current Activity so Tauri retains a live WebView and
unsent drafts. See [Android's inset guidance](https://developer.android.com/develop/ui/views/layout/edge-to-edge).

Committed Back hides the IME first, then uses the existing overlay Escape handlers,
then mobile pane history. At the root it backgrounds the task. Canceled predictive
Back gestures do not dispatch navigation. The native share composer asks before
discarding on Back/outside dismissal; Keep editing retains its current contents.
Android editors use normal Lexical caret handling, without the iOS cursor plugin.

Incoming SEND/SEND_MULTIPLE text, URLs, and `content://` streams enter an atomic
private-cache queue. Providers are read while their URI grant is valid; names and
reported sizes are not trusted as paths or byte counts. Staging limits each intent
to 500 MiB total and 100 attachments. Files are checksummed while copying;
PDFs and other documents use the regular document-creation flow with native
streaming PUT and the S3 checksum header. Media uses the static-file uploader.
Failed uploads stay visible with a Retry action and block sending until resolved.
Missing or corrupt batches report an error and do not strand later shares.
The queue retains original bytes until send/cancel, survives process restarts and
login, and keeps a second share behind the active composer. Abandoned staging is
removed after 24 hours. Ordinary attachment selection continues to use the WebView
file input and Android's picker; no parallel photo-picker adapter is introduced.

Blob downloads use chunked native export and Android's Save dialog. Large transfers
show progress and can be canceled before the system chooser opens; canceled Save
dialogs do not report success. Email clipboard attachments use native bytes and
their actual size/checksum, including the email attachment-size limit. Image sharing
and copying use FileProvider content URIs with temporary read grants. Exported
files remain in a narrow private-cache provider directory for asynchronous
receivers and expire after 24 hours. The provider also exposes app-specific
Pictures for the WebView camera-capture fallback; it does not expose external
storage roots. The app removes device-info's unused legacy read/write-storage and
battery-stat permissions from the merged manifest. Downloads already authenticated/fetched by the app preserve those
bytes rather than reopening a URL in an unauthenticated external browser.

From `apps/web`, after installing the current debug APK and letting Macro load:

```sh
ANDROID_SERIAL=<dedicated-emulator-serial> bun tests/native/android/smoke.mjs
bunx vitest run src/lib/core/mobile/androidWindowInsets.test.ts src/lib/core/mobile/androidBack.test.tsx src/lib/core/mobile/androidFiles.test.ts src/lib/service-clients/service-storage/util/upload-native.test.ts src/features/channel/Input/tests/upload-attachments.test.ts
```

Use a dedicated emulator with no pending personal share. The smoke test injects a
temporary input, exercises native clipboard/export and incoming-share commands,
verifies font-scale and display-density changes retain the WebView/draft and
keep bottom controls inside the CSS viewport at tablet/foldable-sized windows, force-stops/relaunches
Macro, and writes results/screenshots under
`/tmp/macro-task03-smoke`. It never sends a message; a signed-in share composer can
upload the test attachment as it normally does. In Gboard's settings, Physical
keyboard → Show on-screen keyboard must be enabled to test the docked IME; the
system setting alone can leave Gboard showing only its physical-keyboard toolbar.

The plugin's tests use an isolated package (`com.macro.mobile.test`) and never
clear Macro's data. From the generated Gradle project, build/run them with:

```sh
./gradlew :tauri-plugin-android-mobile:testDebugUnitTest :tauri-plugin-android-mobile:assembleDebugAndroidTest
adb -s <serial> install -r ../../../android_mobile_plugin/android/build/outputs/apk/androidTest/debug/tauri-plugin-android-mobile-debug-androidTest.apk
adb -s <serial> shell am instrument -w com.macro.mobile.test/androidx.test.runner.AndroidJUnitRunner
```

These instrumented tests exercise Android content providers, duplicate URIs,
multiple streams with text, delayed consumption/recreation, missing files,
permission failures, MIME fallback, bounded large streams, and corrupt queues. Keep device qualification separate
from these checks: test real channel/email/AI/document editors, selection and
formatting, non-Latin IME composition, emoji/dictation, hardware keyboards,
TalkBack/large text, Samsung Keyboard, cloud providers/large files, rotation,
three-button/gesture navigation, canceled predictive Back, and tablet/foldable
windows before closing task 03. An API 36 emulator cannot establish the whole
physical-device matrix.

## App Links

App Links require a domain association for `com.macro.app.prod` and the certificate
that signed the installed APK. From `apps/web`, generate a candidate association:

```sh
bun scripts/android-assetlinks.ts 'AA:BB:...32-byte-SHA256-fingerprint...'
```

Publish the resulting JSON at `https://<host>/.well-known/assetlinks.json` for each
intended host: `macro.com`, `dev.macro.com`, `staging.macro.com`. This repository
does not automatically publish the source file to those domain roots. Production needs
the **Play App Signing** fingerprint, not merely the upload key; keep debug
certificates on the development host. Builds do not publish domain associations.

Google's Digital Asset Links service caches association results separately from
the hosting CDN. A freshly published file can be correct while Android still reports
the previous result; wait for the service's reported cache lifetime before
re-verifying. Do not force a domain to `approved` or `verified` to claim success.

After installing an APK signed with an associated certificate:

```sh
adb shell pm verify-app-links --re-verify com.macro.app.prod
adb shell pm get-app-links com.macro.app.prod
adb shell am start -W -a android.intent.action.VIEW -c android.intent.category.DEFAULT -c android.intent.category.BROWSABLE -d 'https://dev.macro.com/app/task/TASK_ID'
```

Adding `-p com.macro.app.prod` tests routing but does not prove domain verification.
Test cold/warm links, auth cancellation/retry, email-code login, relaunch with a
session, logout/account switching, and entity links through login. Repeat with
signed release builds and actual provider sign-in.

### Publishing associations

Publication procedure for the hosting owner:

1. Recheck the chosen hostname's DNS, valid HTTPS certificate, CDN aliases and
   `/.well-known/*` origin. Confirm the endpoint returns HTTP 200 with JSON
   directly, without a redirect or an HTML fallback.
2. Obtain the SHA-256 **app-signing** fingerprint from Play Console for
   `com.macro.app.prod`. The upload certificate is only suitable for testing
   locally signed builds. If staging is used for such a test, explicitly select
   the local-release certificate; keep debug certificates confined to dev.
3. Download and retain the existing association JSON, S3 ETag and object metadata.
   Generate the candidate Macro statement from `apps/web`:

   ```sh
   bun scripts/android-assetlinks.ts 'PLAY_APP_SIGNING_SHA256' > /tmp/macro-assetlinks-candidate.json
   ```

   Replace the placeholder with the actual 32-byte colon-separated fingerprint.
   Merge the generated statement into the downloaded array, preserving unrelated
   packages, relations and any still-required certificates. The generated file is
   a candidate statement, not a replacement for the full live object. Removing
   legacy associations requires a separate ownership/usage check.
4. Review the merged JSON for the exact package, certificate and
   `delegate_permission/common.handle_all_urls` relation. Upload only the chosen
   `.well-known/assetlinks.json` object, using `Content-Type: application/json`,
   a short cache lifetime (e.g. `max-age=300`) and `--if-match` with its prior ETag.
   If the ETag changed, fetch and merge again instead of overwriting new content.
5. Invalidate only `/.well-known/assetlinks.json` on that host's distribution.
   Fetch the public URL again, confirm the intended JSON and preservation of old
   entries, and check Google's Digital Asset Links result for the exact
   host/package/certificate. Allow its independent cache to expire as necessary.
6. Install the appropriate signed build. Run the verification commands above and
   require `verified` for each intended host. Test natural cold/warm links with
   both DEFAULT and BROWSABLE categories, without a package override or forced
   approval. Exercise an entity link while signed in and through a login detour,
   including query preservation. Repeat with a Play-installed build when
   validating the Play App Signing certificate.
7. Record the artifact certificate, host, served JSON, verification result and
   route result. If rollback is needed, restore the saved JSON and metadata with
   a conditional write against the published ETag, then invalidate the same URL.
   Reconcile concurrent edits before restoring anything.
