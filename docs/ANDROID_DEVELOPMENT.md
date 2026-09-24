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
  the Tauri CLI (`cargo tauri`). The clean-checkout validation below records the
  tool versions used.
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
Other ABIs are task 06 and Play distribution is task 07. Release builds require
the signing configuration below and produce signed artifacts.

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
adb shell am start -W -a android.intent.action.VIEW -c android.intent.category.DEFAULT -c android.intent.category.BROWSABLE -d 'https://dev.macro.com/app/task/TASK_ID'
```

Adding `-p com.macro.app.prod` tests routing but does not prove domain verification.
Test cold/warm links, auth cancellation/retry, email-code login, relaunch with a
session, logout/account switching, and entity links through login. Real provider
testing and signed release qualification are required before completing task 01.

### Production and staging publication handoff

Task 01 prepares this handoff and verifies development links. Task 07 owns the
Play certificate, publication using that certificate, and Play-installed checks.
Task 06 owns any hosting preparation that can proceed without Play access.

Read-only inspection on 2026-09-23 found:

| Host | Hosting and current response | Next step |
| --- | --- | --- |
| `dev.macro.com` | CloudFront `E1YKU2ZF1GN77R`, `/.well-known/*` routes to `macro-oidc-dev`; HTTPS returns JSON containing this checkout's debug and upload certificates for `com.macro.app.prod`. | Preserve the verified development association and other existing entries. |
| `macro.com` | CloudFront `E17BXLF369UBEG`, `/.well-known/*` routes to `macro-oidc-prod`; HTTPS returns JSON with a legacy `com.tauri.dev` association. | Add `com.macro.app.prod` with the Play App Signing certificate when available. Do not publish the development certificate file here. |
| `staging.macro.com` | DNS resolves, but HTTPS fails its TLS handshake; neither inspected distribution declares this hostname, and no staging alias was present in the account's distribution list. | Establish the intended staging HTTPS/CDN origin and `/.well-known/*` routing before publishing or claiming staging verification. Do not assume the production bucket owns staging. |

The S3 object key for the confirmed dev/prod routes is
`.well-known/assetlinks.json`. The website infrastructure owns these distributions;
the app build does not deploy them. The manifest declares `/app` links on all
three hosts. Staging testing is deferred until its hosting works; it is not a
substitute for the completed development-host checks.

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
   including query preservation. Task 07 repeats this with a Play-installed build.
7. Record the artifact certificate, host, served JSON, verification result and
   route result. If rollback is needed, restore the saved JSON and metadata with
   a conditional write against the published ETag, then invalidate the same URL.
   Reconcile concurrent edits before restoring anything.

## Clean-checkout validation

On 2026-09-23, app commit `fe0385bbe1` was checked out into a new detached
worktree. No `node_modules`, frontend/WASM output, Cargo target directory or
Gradle project build output was copied from the development checkout. Normal
machine-level dependency caches and the installed SDK were available.

The run used Bun 1.3.13, Rust 1.94.0, Tauri CLI 2.9.6, wasm-pack 0.13.1,
just 1.45.0, Java 21, SDK 36 and NDK 30.0.16248370. After
`bun install --frozen-lockfile`, the existing Firebase inputs were provisioned in
ignored files and the signing key was restored from Doppler into owner-only
temporary storage outside the checkout. From `apps/web`, both commands passed:

```sh
just android-build --debug --apk true --aab false -- --no-default-features
just android-build --apk true --aab true -- --no-default-features
```

Both APK signatures, package/version metadata and 16 KB ZIP alignment passed.
The release APK was non-debuggable and matched the backed-up upload certificate;
the AAB passed `jarsigner -verify` and bundletool validation. The debug APK
installed on a fresh API 36 emulator, displayed login, and received a natural
cold development App Link with Android reporting `dev.macro.com: verified`.
The release APK replaced the existing local release installation without clearing
data; a natural cold Settings link retained the authenticated production account.
The eight focused auth/navigation/Firebase test files passed all 43 tests.
Tracked files in the clean checkout remained unchanged.

This run used embedded production assets with OTA disabled. Tasks 05–07 retain
OTA qualification, the wider device/ABI/16 KB runtime matrix, staging hosting
preparation, and Play-installed release checks.
