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
Release builds automatically prepare the signing configuration below and produce
signed artifacts. Debug builds do not fetch release signing credentials.

## Release signing

The existing upload keystore and signing credentials are stored in Doppler
`android-release/prd`, secret `ANDROID_UPLOAD_SIGNING_JSON`. It contains
`keystore_base64`, `keystore_sha256`, `certificate_sha256`, `package_name`,
`key_alias`, `key_password`, and `store_password`. Keep them outside the checkout
and provision them securely for CI.
Coordinate key replacement with Play Console; do not generate a new key for
routine builds.

`just android-build` preserves existing `gen/android/keystore.properties`
configuration, including CI-provisioned signing. When it is missing, the launcher
reuses signing files in `~/.macro-android-signing`, or fetches the existing key
from Doppler and creates that private directory on the first release build.
Other worktrees reuse the same directory through their own properties symlink.
Install the Doppler CLI and authenticate with read access to `android-release/prd`
(CI can use `DOPPLER_TOKEN`). Missing access fails before compilation.
Broken symlinks or incomplete signing directories fail without replacing files;
restore the files or manually provision to a new private directory.

To use a different private location, provision signing from `apps/web` (the
private destination directory must not already exist):

```sh
bun scripts/android-release.ts signing /absolute/private/path/android-signing tauri/src-tauri/gen/android/keystore.properties
```

This validates the package and keystore checksum, writes owner-only files, and
symlinks Gradle's properties file. It refuses to replace existing configuration.
The destination's parent must exist. Do not print the secret JSON in terminals or
CI logs.

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

### Production release APKs

`.github/workflows/release-production.yml` builds an ARM64 signed APK alongside
each production deployment, from the release commit. It uses production services,
the pinned production Firebase config, and the normal OTA-enabled release build.
The GitHub Actions `ANDROID_RELEASE_DOPPLER_TOKEN` secret must have read access to
`android-release/prd`, including both the signing JSON and pinned Firebase secret.
CI passes this dedicated read-only service token as `DOPPLER_TOKEN` only during
configuration retrieval. Signing files live in the runner's temporary directory
and are removed even when the build fails. Only APK/checksum files are attached
to the release; the separate `android-build-log` Actions artifact is retained for
seven days, including on failed builds.

Release tags must follow `vYYYY.M.D.N`, with a valid date, years 2000–2099, and a
daily revision from 0–99. Android's `versionCode` is `YYYYMMDDNN` (for example,
`v2026.9.28.1` becomes `2026092801`), and `versionName` is `2026.9.28-1`.
New releases must increase the date/revision; a rerun retains the same version.
Always keep the signing key to allow upgrades over earlier distributed APKs.

Before upload, CI verifies the signing certificate, package/version, ARM64 ABI,
non-debuggable manifest, and 16 KiB ZIP alignment. Publishing waits for the web,
cloud-storage, sync-service, and AI editing worker deployments. Android failures
fail their job without blocking web/backend rollout. CI verification does not
replace the device qualification described above.

To recover an Android artifact without redeploying production, manually run
`release-production.yml` with `release_tag` set to an existing published
production release. The source is checked out from that tag; web/backend jobs
are skipped. `publish_android` defaults to false so the first run can validate
the build and leave the APK in the `android-release` Actions artifact. Set it to
true to attach the verified APK and checksum to the selected release:

```sh
gh workflow run release-production.yml --ref main -f release_tag=v2026.9.30.0 -f publish_android=true
```

The Android job uses an ephemeral GitHub-hosted runner without a separate Nix
cache mount. Do not invoke the shared `teardown-nix` cache-volume action there:
its `fuser -km /nix` can kill the runner when `/nix` is on the root filesystem,
preventing GitHub from receiving the build logs. Let the hosted VM be discarded.

The public GitHub release receives `macro-<tag>-android-arm64.apk` and
`macro-<tag>-android-arm64.apk.sha256`. Share the APK's release download link;
recipients do not need GitHub access. They open the downloaded APK and allow
installation from that browser/file manager when Android prompts. Subsequent
APKs install as updates when the certificate matches and the version increases.
Play Store migration must preserve app-signing compatibility with these APKs.

## Firebase

The launcher fetches Firebase configuration before both development and release
builds. Remote notifications require the matching configuration and Google Play
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

### Reproducible configuration

Install the Doppler CLI and run `doppler login` with access to the `android-release`
project. A fresh checkout then needs no manually downloaded Firebase files:

```sh
just android-dev
just android-build
```

The launcher reads `scripts/android-firebase.lock.json`, fetches only its named
Doppler key (`dev` for development, `prd` for production), and checks the SHA-256
of the UTF-8 value with leading/trailing whitespace removed. It validates the
Firebase project and Android package before atomically writing the ignored
`tauri/src-tauri/gen/android/app/google-services.json` consumed by Gradle.

Each config has a versioned key, initially `GOOGLE_SERVICES_JSON_V1`. Missing
authentication, a missing key, a checksum mismatch, or an invalid config stops
the build before Cargo starts. Existing local config files are not a fallback:
they cannot silently change which Firebase configuration a commit builds with.
The config is fetched on each invocation, so the default path requires network
access. The lock file pins Firebase configuration, not every input needed for
byte-identical APKs; the toolchain, dependencies, frontend configuration, and
release signing must also be supplied consistently.

For CI, install the Doppler CLI and provide a read-only Doppler service token for
`android-release/prd` as the CI secret `DOPPLER_TOKEN` (`android-release/dev` for
development). Run the same `just android-build` command. The CLI uses this token
without an interactive login. Never expose the production token to builds of
untrusted fork PRs. This setup retrieves Firebase configuration only; release
signing still uses the credentials described above.

### Custom builds and forks

To build without Doppler, explicitly supply a config downloaded from Firebase:

```sh
just android-dev --firebase-config /absolute/path/google-services.json
just android-build --firebase-config /absolute/path/google-services.json
```

An explicit file bypasses the Doppler fetch and checksum pin. It still must
contain `com.macro.app.prod`, the current Android package. Other Firebase project
IDs are allowed for forks; Macro's known dev/prod projects are still rejected
when used with the opposite build command. Forks changing the Android package
must also update the package validation in `scripts/android-firebase.ts` and
configure their own backend. Local files under `firebase/dev` or `firebase/prod`
are used only if passed explicitly with `--firebase-config`.

Do not commit Firebase config files or Doppler tokens. Only the lock file belongs
in Git; keeping the actual configs outside this public repository lets forks use
their own Firebase resources.

### Updating the pinned configuration

1. Download the updated Android config from the intended Firebase project and
   validate its package and project ID.
2. Store it under a **new** key in the matching `android-release` Doppler config
   (for example, `GOOGLE_SERVICES_JSON_V2`). Keep every older pinned key unchanged
   so older commits remain buildable. Pass the value through stdin, not a command
   argument, and suppress command output to avoid printing it:

   ```sh
   doppler secrets set GOOGLE_SERVICES_JSON_V2 --project android-release --config prd < /path/google-services.json > /dev/null
   ```

3. Update that environment's key and SHA-256 in `scripts/android-firebase.lock.json`.
   Compute the checksum using the same whitespace normalization as the downloader:

   ```sh
   bun -e 'const text = (await Bun.file(process.argv[1]).text()).trim(); console.log(new Bun.CryptoHasher("sha256").update(text).digest("hex"));' /path/google-services.json
   ```

4. Test retrieval into a new temporary destination with
   `bun scripts/android-firebase.ts build --doppler /tmp/android-firebase-check/google-services.json`
   (use `dev` for development). Review and commit the lock-file change; never
   replace the checksum just to silence an unexpected mismatch.

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

## Offline and OTA qualification (Task 05)

Use a dedicated installation. Local APK upgrades need the same package and
signing key and an increasing versionCode. A local test key may sign a
release-optimized APK; preserve it outside the checkout for local upgrades and
never use it for Play uploads. To build an emulator APK, run
`cargo tauri android build --target x86_64 --apk --ci` from
`apps/web/tauri/src-tauri` inside the Android Nix shell. ARM64 uses the launcher
above. Keep OTA enabled for update acceptance; `--no-default-features` qualifies
only embedded behavior. Shared OTA builds need both `MIN_NATIVE_BUILD_ANDROID`
and `MIN_NATIVE_BUILD_IOS`; see the
[native compatibility contract](../apps/web/tauri/src-tauri/README.md).

Android ConnectivityManager reports the validated default network and takes a
fresh snapshot on resume. Captive/unvalidated networks count as offline. Older
native binaries lacking the command retain browser connectivity. Neither signal
proves a particular backend is reachable. The activity unregisters its monitor
on destruction.

Android backup is disabled. API 31+ cloud-backup/device-transfer rules exclude
normal and device-protected private storage, databases, preferences, and external
app files, including credentials, WebView cookies, cache, drafts, and staging.
An app upgrade still preserves app-private data. Logout clears all query stores,
including unhydrated entries, fences pending hydration, and clears the native
normalized cache/queue. Failed wipes quarantine the disk namespace. The new query
namespace deliberately discards legacy read caches on the first upgrade.

Record device/API/WebView, APK certificate/versionCode, embedded/active bundle
build, and these results for locally installed release builds:

| Case | Required evidence |
| --- | --- |
| Acknowledged edit, queued/optimistic mutation, cached document/list, durable draft/upload workflows | Background/resume and process kill/relaunch preserve state; reconnect drains queued work without duplication |
| Airplane mode, Wi-Fi/cellular transition, captive network | Correct native status; cached reads; session refresh; websocket subscriptions recover |
| Missed websocket events | Replay deduplicates retained events; gaps resynchronize |
| Logout and second-account login, including offline logout | No prior-account records, drafts, staged files, or queued writes appear or replay |
| Local native upgrade signed with the same key | Data survives and build detection returns installed versionCode |
| Higher Android minimum in a newer iOS/shared bundle; legacy/unknown metadata | Older Android stays functional and rejects incompatible JS |
| Kill during download/extraction; truncated archive; cache eviction | Partial assets are never selected; failures retain working embedded/active assets |
| Revocation, apply on resume, unavailable store handler/listing | Embedded fallback; correct generation acknowledgment; dismissible update dialog |
| Lower-end physical hardware | Cold/warm launch and hydration times, large lists/documents, peak PSS, background CPU/battery and Doze |

Background then use `adb shell am kill com.macro.app.prod` and verify the PID
has disappeared for normal process death. Force-stop/relaunch is a separate case.
Use `adb shell am start -W -n com.macro.app.prod/.MainActivity` for launch timings,
`adb shell dumpsys meminfo com.macro.app.prod` for PSS, and Perfetto/Android Studio
for rendering/CPU/battery evidence. A VM emulator cannot qualify physical battery,
cellular handoffs, OEM memory pressure, or lower-end hardware. Do not reset shared
device statistics or account data. Keep evidence free of credentials/content.

Task 07 owns live Play listing verification and a real Play-delivered update.
Task 05 retains offline/account isolation and shared-JS/older-native acceptance,
using local release installations and local version upgrades. No Play Console is
required.

Local evidence recorded on 2026-09-30 uses an isolated API 36 x86_64 emulator
with 2 GB RAM, production frontend, OTA enabled, and a local test signing key.
Release versionCodes 2005000, 2005001, and 2005002 installed successfully.
The final 2005001 → 2005002 upgrade preserved a committed native cache record and
a WebView storage value; native build detection returned 2005002. Airplane mode
reported offline then online; disabling Wi-Fi retained emulator cellular
connectivity. Acknowledged native records and optimistic queued mutations
survived background process death. The recovered queue allowed only one lease
at a time; changing a synthetic account identity cleared the records and queue.
The update-required dialog rendered and its explicit OK button dismissed it on
Android; a mobile component regression covers unavailable-store failure.

Signed-out launch was 837 ms initially and 186 ms after process death, with
approximately 137 MiB app PSS after relaunch. A synthetic 5,000-document native
cache write took 2.39 s; five cached reads took 15–21 ms, with approximately
173 MiB app PSS afterward. These measure native cache/IPC, not document/list
rendering or signed-in hydration. Immediate WebView writes need a disk flush:
an immediate replacement-install test lost its sentinel; backgrounding for
10 seconds before replacement preserved it. Acknowledged native database writes
survived process death and upgrade independently of that WebView flush.

Automated coverage includes platform-specific OTA minima and legacy rejection,
interrupted extraction and missing completion markers, eviction/revocation and
embedded fallback, cache/queue reopen, logout hydration fencing and durable
query-store wiping, draft/upload persistence, session refresh, websocket
reconnect/replay, native reachability, and store-link failure recovery.
Additional installed-release evidence on 2026-10-01 uses two dedicated signed-in
accounts and local signed upgrades through versionCode 2005005. Both accounts'
acknowledged document edits and offline edits survived background process death
and reopening the cached document. A fresh authenticated sync client confirmed
account A's queued edit reached the server. A server-acknowledged peer edit made
while the Android client was offline appeared exactly once after reconnect.
Real offline logout followed by the second account's email-code login exposed
neither the first account's draft nor its cached test document. A fresh
authenticated sync client also confirmed account B's queued edit reached the
server. Online logout of account B removed its session and composer storage.

The Home Ask AI composer's unsent text and a file selected there while offline
both disappeared after process death. Loss of these unsent Home inputs is an
accepted behavior for Task 05, not an acceptance blocker. The original selected
file remains on the device. This exception does not cover acknowledged document
edits, durable drafts elsewhere, or committed upload workflows. Existing
persisted Home/Agents composer and attachment projections use account-specific
keys, and logout clears both legacy and scoped keys.

A loopback-only controlled OTA feed exercised the installed release with real
production assets. Dropped downloads, truncated archives, bad checksums, legacy
and unknown schemas, and incompatible Android minima were rejected. Rejected
updates retained an existing active bundle. Killing the process during Unzipping
retained the previous complete bundle; retry completed. Resume applied a valid
bundle with an Android-compatible minimum and a much newer iOS minimum.
Background process death during download retained embedded assets, and retry
completed. Revocation recovered to embedded assets. These tests found an embedded-entrypoint
routing bug that could load the previous OTA index after rollback; the resolver
now selects the embedded index, with regression coverage and installed-release
rollback verification. The local-feed APK is a test artifact: its feed override
must be omitted from a distributed release.

Actual Android OS cache eviction is not qualified: the API 36 emulator's
`pm clear --cache-only com.macro.app.prod` command hung and did not remove the
active OTA cache. Missing-assets/eviction recovery remains covered by updater
unit tests. Expired-session refresh, all pending-upload and queued-write logout
paths, actual large-document rendering/hydration, and physical memory-pressure,
battery, and cellular testing remain necessary for full Task 05 acceptance.
Play verification remains Task 07.
