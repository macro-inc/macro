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
