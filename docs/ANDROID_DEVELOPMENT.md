# Android development

Macro's Android package is `com.macro.app.prod`. Its Gradle project lives in
`apps/web/tauri/src-tauri/gen/android`. Keep the project and wrapper in source
control; do not regenerate them to repair a build error.

## Prerequisites

- Run `bun install --frozen-lockfile` with the repository's Bun/Rust tools installed.
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
`tauri/src-tauri/gen/android/app/build/outputs/`. The launcher defaults to ARM64;
other ABIs and Play distribution are task 06. Release builds require the signing
configuration below and produce signed artifacts.

## Release signing

The existing upload key is backed up in Macro's Doppler workspace, project
`android-release`, production config `prd`, secret `ANDROID_UPLOAD_SIGNING_JSON`.
This JSON contains `package_name`, `key_alias`, `store_password`, `key_password`,
`keystore_base64`, `keystore_sha256`, and `certificate_sha256`. The backup was
retrieved and verified against the original on 2026-09-23, including opening the
restored keystore and matching its certificate.

For recovery, retrieve that secret without printing it to terminal output or logs,
decode `keystore_base64` to an owner-only file outside the checkout, and verify
`keystore_sha256`. Populate the properties below from the recovered passwords and
alias, using the restored file's absolute path. Keep access limited to release
maintainers and build jobs that need to sign uploads; this secret is not runtime
app configuration. Retain the existing key instead of generating a replacement.

If a new upload key is ever required, follow
[Tauri's Android signing guide](https://v2.tauri.app/distribute/sign/android/)
and coordinate any replacement with Play Console. Key creation and backup do not
require completed Google Play identity verification.

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
Android remote push registration is disabled until task 02 implements its token,
permission, and notification watcher contracts. Local notifications remain available.

Both environments already have package **com.macro.app.prod** registered:

| Build command | Firebase project | Existing SNS credential |
| --- | --- | --- |
| `android-dev` | `macro-app-dev-12ae0` | `fcm-credential-dev` |
| `android-build` (including `--debug`) | `macro-app-955f1` | `fcm-credential-prod` |

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
fail with an explicit error if configuration is absent; this is our project
guardrail, not a Google Play requirement. Push delivery and token lifecycle
implementation remain task 02. Firebase setup does not require Play approval.

## Browser authentication

Android uses `android_auth_plugin` and AndroidX Auth Tab, with a Custom Tabs
fallback. Each attempt creates `macro://android-auth/<random UUID>` before the
backend creates OAuth state. The receiver checks the exact authority/path and
rejects duplicate parameters and mismatched callbacks. Canceling settles the
request so another attempt can start. Never log callback URLs or session codes.
Android navigation uses `macro://app/<route>`; its MainActivity filter is scoped
to host `app` so older browsers send `macro://android-auth/...` exclusively to
the authentication receiver, without an activity chooser.

Login redeems a one-time code using the existing native HTTP cookie jar.
Gmail/calendar/GitHub linking completes server-side and refreshes queries without
replacing the Macro session. After process death mid-flow, restart authentication;
orphaned callbacks must not silently log in the replacement process. Macro logout
does not sign out of Google/GitHub in the system browser.

iOS retains its existing auth/keyboard plugins. Android does not build the invalid
keyboard scaffold; native IME/inset support is task 03.

## App Links

The old Tauri-example association was invalid for Macro. The checked-in
`src-tauri/.well-known/assetlinks.json` is empty pending real signing certificates.
Generate an association for the correct package with:

```sh
bun scripts/android-assetlinks.ts 'AA:BB:...32-byte-SHA256-fingerprint...'
```

Publish the resulting JSON at `https://<host>/.well-known/assetlinks.json` for each
intended host: `macro.com`, `dev.macro.com`, `staging.macro.com`. This repository
does not automatically publish the source file to those domain roots. Production needs
the **Play App Signing** fingerprint, not merely the upload key; keep debug
certificates on the development host. Builds do not publish domain associations.

Development associations for this checkout's debug and local-release certificates
are in `src-tauri/.well-known/assetlinks.dev.json`; never publish this file to the
production domain. The development website's `/.well-known/*` CloudFront behavior
currently reads from S3 bucket `macro-oidc-dev`. The object key is
`.well-known/assetlinks.json` and the distribution is `E1YKU2ZF1GN77R` (owned by
the separate website infrastructure). Merge new associations with existing
entries, publish as `application/json`, and invalidate only that URL. Use a
conditional write against the previous ETag to avoid overwriting concurrent
edits. Keep this object when deploying the website's other well-known files.

Google's Digital Asset Links service caches association results separately from
CloudFront. A freshly published file can be correct while Android still reports
the previous result; wait for the service's reported cache lifetime before
re-verifying. Do not force a domain to `approved` or `verified` to claim success.

After installing an APK signed with an associated certificate:

```sh
adb shell pm verify-app-links --re-verify com.macro.app.prod
adb shell pm get-app-links com.macro.app.prod
adb shell am start -W -a android.intent.action.VIEW -d 'https://dev.macro.com/app/task/TASK_ID'
```

Adding `-p com.macro.app.prod` tests routing but does not prove domain verification.
Test cold/warm links, auth cancellation/retry, email-code login, relaunch with a
session, logout/account switching, and entity links through login. Real provider
testing and signed release qualification are required before completing task 01.
