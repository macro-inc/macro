# Android development

Macro's Android package is `com.macro.workspace.mobile`. Its Gradle project lives in
`apps/web/tauri/src-tauri/gen/android`. Keep the project and wrapper in source
control; do not regenerate them to repair a build error.

The Android-specific Tauri config overrides the shared identifier. iOS and desktop
retain `com.macro.app.prod`. The Android activity package and native certificate
verifier's JNI symbol must match the Android identifier.
When switching an existing checkout, remove the obsolete ignored
`gen/android/app/src/main/java/com/macro/app/prod/generated` directory. Tauri
generates classes for the new package during the build; keep the Gradle project.

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
just android-build --apk false --aab true
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
`android-release/prd`, secret `ANDROID_UPLOAD_SIGNING_JSON_V2`. It contains
`keystore_base64`, `keystore_sha256`, `certificate_sha256`, `package_name`,
`key_alias`, `key_password`, and `store_password`. Keep them outside the checkout
and provision them securely for CI.
The V2 signing metadata names the new Android package and retains the existing
upload key. Keep the unversioned metadata for builds of older commits. Coordinate
key replacement with Play Console; do not generate a new key for routine builds.

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
just android-build --apk true --aab false -- --no-default-features
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

### Releasing to Google Play from a pull request

Android releases are driven from pull requests, like iOS (see
`apps/web/docs/ios-releases.md`); they are not tied to the production
deployment cycle. Three generated workflows plus the `Android Native Check`
job of the web app PR checks enforce it:

**`Android Native Check`** runs on every PR against `main`. Its native tree
excludes platform-specific desktop/iOS files and Markdown docs, which do not
ship in the Android binary (`apps/web/scripts/android-native.mjs` defines
what counts). When the Android native code changed, it requires a
`versionCode` bump and asks Google Play whether that version code is a
production release that Google has **published** (through review and
available to users — the edit API's `status: completed` only describes the
rollout, so the gate also reads the release list's `releaseLifecycleState`),
built from the native code of the PR's merge result. Until both hold the
check fails and the required `Web App Status Check` fails with it.

Add **`skip-android-update`** instead for native changes that don't break
the native/web contract: it skips the whole gate, bump included, like
`skip-ios-update`. Such a PR never releases, and the bump only feeds the
Play release, which checks it again before building; the next PR that
releases bumps against whatever `main` has by then. The `Native Check
Label` workflow re-runs just the gate job when that label is added or
removed.

To release:

1. Bump and commit: `just android-bump` in `apps/web`.
2. Add the **`android-update`** label once the PR is ready to merge. The
   **`Android Play Release`** workflow (`.github/workflows/android-play-release.yml`)
   first refuses drafts, PRs with failing checks (pending ones are waited on,
   up to 30 minutes), PRs without a bump, and PRs whose head lacks Android
   native code that landed on `main` since they branched (the gate hashes
   the merge result, so such a bundle could never pass it; merge `main`,
   bump, re-add the label). It then builds the signed App Bundle from the PR
   head on a hosted Ubuntu runner (Android SDK, Nix, signing and Firebase
   config from Doppler `android-release/prd`), verifies it with bundletool,
   checks again that neither the PR head nor `main` changed native code
   during the build, uploads it to the **internal** track with
   `status=completed`, and promotes it to **production** as a full rollout
   (Google review applies). The bundle and R8 mapping are kept as a workflow
   artifact for 90 days. The release notes carry a provenance stamp,
   `native tree <hash> for PR #<n>`, the twin of the iOS TestFlight stamp.
   The run comments the outcome on the PR; remove and re-add the label to
   retry. Click **Enable auto-merge** on the PR to merge the moment it is
   live. The label only works on a PR that is mergeable: GitHub does not
   run `pull_request` workflows on a PR that conflicts with `main`, so the
   release never starts there. The **`Release Label Check`** workflow
   (`.github/workflows/release-label-check.yml`, a `pull_request_target`
   workflow, which GitHub does run) then comments and removes the label;
   resolve the conflicts and re-add it. On a mergeable PR that workflow
   instead comments that the release started, with the version in flight
   and a link to the run.
3. Wait for Google. The **`Android Release Watch`** workflow (every 30
   minutes) notices the version code being published on production, re-runs
   the PR's failed `Android Native Check` job, and comments; the PR merges if
   auto-merge is on.
4. Pushes after the label: web-only commits need nothing. Native commits make
   the bundle stale: **`Android Release Drift`** cancels an in-progress build,
   removes the label and comments. A Play production release cannot be
   withdrawn once submitted, so if the stale bundle was already promoted the
   comment says so and the follow-up should ship as soon as possible (after
   a force-push the old head is gone, so drift checks Play for the new
   head's version code instead).

Play is the source of truth for what is live; nothing ties Android bundles
to production release tags any more. `publish-android-play.yml` remains as
the manual fallback (promote a version code by hand; upload a bundle from a
GitHub release that carries one).

The native build uses production services, the pinned production Firebase
config, and the normal OTA-enabled release build. The GitHub Actions
`ANDROID_RELEASE_DOPPLER_TOKEN` secret must have read access to
`android-release/prd`, including both the signing JSON and pinned Firebase
secret; CI passes this dedicated read-only service token as `DOPPLER_TOKEN`
only during configuration retrieval. Signing files live in the runner's
temporary directory and are removed even when the build fails. The separate
`android-build-log` Actions artifact is retained for seven days (unlike the
90-day `android-release` bundle artifact), including on failed builds.

The Android workflows use ephemeral GitHub-hosted runners without a separate
Nix cache mount. Do not invoke the shared `teardown-nix` cache-volume action
there: its `fuser -km /nix` can kill the runner when `/nix` is on the root
filesystem, preventing GitHub from receiving the build logs. Let the hosted
VM be discarded.

Testers install through Google Play's internal testing track once the
bundle is uploaded; an AAB cannot be installed directly on a device.

### Google Play publishing

`.github/workflows/publish-android-play.yml` runs from `main` and is the
manual fallback. Routine releases go through the `Android Play Release`
workflow described above, which uploads the PR's bundle to internal testing
and promotes it to production itself; the publishing workflow is for
promoting a version code by hand or uploading a bundle attached to a GitHub
release.

#### First bundle (one time)

The Play app must already exist, and its first AAB must be uploaded manually
before the publishing API can find the package. See the
[upload action's setup guide](https://github.com/r0adkll/upload-google-play#faq).

1. Build the first AAB locally from the intended source and verify it using
   the release signing procedure above (the `Android Play Release` workflow
   cannot run before the package exists in Play Console).
2. Download `macro-<tag>-android-arm64.aab` and its checksum from the release (or
   from the `android-release` Actions artifact for a build-only run). Verify the
   checksum before upload.
3. In Play Console, open Macro → **Testing → Internal testing**, create a release,
   and enroll in [Play App Signing](https://developer.android.com/studio/publish/app-signing).
   Decide the installed-app signing key before enrollment: a Google-generated
   signing key differs from the existing sideloaded APK certificate. Updating
   those installs in place requires preserving their signing identity. The
   existing Doppler key remains the upload key; do not replace it for CI.
4. Upload the AAB, add release notes and testers, and complete the Console's
   required app setup. Save a draft or roll out to internal testers as permitted
   by the app's current state. The API cannot complete account agreements or
   app-content declarations for you.
5. Add the **Play app-signing** SHA-256 certificate to Firebase and the production
   App Links associations below. Test an installation from the Play opt-in link,
   including sign-in, notifications, links, and upgrades.

The first manual upload consumes its version code. For the next binary, run
`just android-bump` in `apps/web` and commit it on the PR that carries the
native change. Do not upload the bootstrap bundle again through CI.

#### Keyless publishing credentials (one time)

Use [Workload Identity Federation through a service account](https://github.com/google-github-actions/auth#workload-identity-federation-through-a-service-account).
The workflow uses GitHub's OIDC identity, so no Google JSON private key is needed
in GitHub or Doppler. The existing Doppler token still supplies Android build
signing and Firebase configuration.

In Google Cloud project `macro-435922`, enable `androidpublisher.googleapis.com`,
`iamcredentials.googleapis.com`, and `sts.googleapis.com`. Create a dedicated
service account named `google-play-publisher`. It does not need a broad
Google Cloud project role. In **Play Console → Users and permissions**, invite
its email and grant app access only to `com.macro.workspace.mobile`, with
**View app information (read-only)**, **Release apps to testing tracks**, and
**Release to production, exclude devices, and use Play App Signing**. The last
permission is required for production promotion. No account-wide or billing
permissions are needed. See
[Google's API access instructions](https://developers.google.com/android-publisher/getting_started).

Create a GitHub Actions workload identity pool/provider. Map:

```text
google.subject=assertion.sub
attribute.repository_id=assertion.repository_id
```

Use issuer `https://token.actions.githubusercontent.com`. Restrict the provider's
attribute condition to the numeric repository and owner IDs (available from
`gh api repos/macro-inc/macro --jq '{repository: .id, owner: .owner.id}'`), the
publishing workflow on `main`, and its branch identity:

```text
assertion.repository_id == '1092407718' &&
assertion.repository_owner_id == '65687018' &&
assertion.workflow_ref == 'macro-inc/macro/.github/workflows/publish-android-play.yml@refs/heads/main' &&
assertion.sub == 'repo:macro-inc/macro:ref:refs/heads/main'
```

On the publishing service account, grant `roles/iam.workloadIdentityUser` to:

```text
principalSet://iam.googleapis.com/projects/1024168288732/locations/global/workloadIdentityPools/github-play/attribute.repository_id/1092407718
```

In GitHub → Settings → Secrets and variables → Actions → Variables, add these
**repository variables**, which contain identifiers, not secrets. The workflow
checks its branch, and the Google provider independently enforces both the branch
and workflow identity:

| Variable | Value |
| --- | --- |
| `GOOGLE_PLAY_WORKLOAD_IDENTITY_PROVIDER` | `projects/1024168288732/locations/global/workloadIdentityPools/github-play/providers/macro` |
| `GOOGLE_PLAY_SERVICE_ACCOUNT` | `google-play-publisher@macro-435922.iam.gserviceaccount.com` |

For a project administrator completing the initial identity setup, these are the
commands for this repository (the publishing service account and required APIs
have already been created/enabled). Pool creation requires
`roles/iam.workloadIdentityPoolAdmin`; binding the service account also requires
permission to update that account's IAM policy. These commands create the pool
and provider once; inspect existing resources before rerunning them.

```sh
gcloud iam workload-identity-pools create github-play \
  --project=macro-435922 --location=global \
  --display-name='GitHub Play publishing'

gcloud iam workload-identity-pools providers create-oidc macro \
  --project=macro-435922 --location=global \
  --workload-identity-pool=github-play \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id' \
  --attribute-condition="assertion.repository_id == '1092407718' && assertion.repository_owner_id == '65687018' && assertion.workflow_ref == 'macro-inc/macro/.github/workflows/publish-android-play.yml@refs/heads/main' && assertion.sub == 'repo:macro-inc/macro:ref:refs/heads/main'"

gcloud iam service-accounts add-iam-policy-binding \
  google-play-publisher@macro-435922.iam.gserviceaccount.com \
  --project=macro-435922 --role=roles/iam.workloadIdentityUser \
  --member='principalSet://iam.googleapis.com/projects/1024168288732/locations/global/workloadIdentityPools/github-play/attribute.repository_id/1092407718'
```

After those succeed, configure the repository variables:

```sh
gh variable set GOOGLE_PLAY_WORKLOAD_IDENTITY_PROVIDER --repo macro-inc/macro \
  --body projects/1024168288732/locations/global/workloadIdentityPools/github-play/providers/macro
gh variable set GOOGLE_PLAY_SERVICE_ACCOUNT --repo macro-inc/macro \
  --body google-play-publisher@macro-435922.iam.gserviceaccount.com
```

#### Manual upload (fallback)

The `Android Play Release` workflow uploads and promotes automatically. For a
manual upload, select **Publish Android to Google Play** in Actions, run from
`main`, select `operation=upload-internal`, and supply a published GitHub
release tag that carries Android artifacts (none are produced automatically
any more; attach them to a release first).
`status=draft` (the default) saves a release for Console review. Select
`status=completed` to release to internal testers, subject to Play's checks:

```sh
gh workflow run publish-android-play.yml --ref main \
  -f operation=upload-internal -f release_tag=v2026.10.9 -f status=completed
```

If Play specifically requires manual review submission, set
`changes_not_sent_for_review=true`, then submit in Console. This input does not
bypass review or make a draft available to testers.

If a run fails, inspect Console before retrying: a completed upload may already
have consumed the version code. Complete or promote an existing draft there
instead of re-uploading it to change status. A new binary needs a new code. Avoid
editing the same app in Console while a CI upload is in progress; committing
another edit invalidates the upload's pending edit.

#### Promote a tested version to production (fallback)

The release workflow promotes automatically. To promote by hand, run the same
**Publish Android to Google Play** workflow from `main` with
`operation=promote-production` and its exact Android `version_code`. Use the code
shown in Play Console; this is not the release tag or marketing version. Leave
`release_tag` empty; `status` applies only to internal uploads.

```sh
gh workflow run publish-android-play.yml --ref main \
  -f operation=promote-production -f version_code=7
```

The promotion script requires that exact version to be a completed, single-version
release currently active in `internal`. It copies its release name, notes, and
update priority into a `completed` production release, validates the edit, and
commits it. This requests a **full rollout**; Google review, production eligibility,
and managed publishing still apply. It does not change the internal track or
upload another AAB. See the [Google Play track API](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks).

The workflow refuses to replace a draft, staged, or halted production release,
and refuses to promote a version older than production. Resolve those states in
Play Console first. Repeating an already-completed promotion is a no-op, provided
that version is still active in internal testing. A newer internal release can
replace the earlier one, so qualify and promote a candidate before uploading the
next candidate. Staged rollouts and their progress are managed in Console.

`changes_not_sent_for_review=true` also applies to promotion if Play requires
manual review submission. Check Console after any ambiguous API failure before
retrying. Failed or no-op attempts discard their pending edit when possible;
commits are never automatically retried. The workflow summary reports submission,
not confirmation that the release is already available to users.

Promotion remains a separate manual action; building a GitHub release or uploading
to internal testing never triggers production promotion. It uses the existing
workflow identity, so no Google identity-provider changes are required.

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
separately. Background the app, then use `adb shell am kill com.macro.workspace.mobile`
for the process-dead case. Android force-stop is a different state that prevents
FCM delivery until the user opens the app again. Also test permission and channel
revocation, logout/account switching, repeated delivery, notification taps, and
read/done clearing. Silent clearing uses normal-priority FCM and may be delayed
by Doze. A local display test alone does not verify backend event delivery.

The launcher requires package **com.macro.workspace.mobile** and validates these projects:

| Build command | Firebase project |
| --- | --- |
| `android-dev` | `macro-app-dev-12ae0` |
| `android-build` (including `--debug`) | `macro-app-prod` |

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

Each config has a versioned key, currently `GOOGLE_SERVICES_JSON_V2`. Missing
authentication, a missing key, a checksum mismatch, or an invalid config stops
the build before Cargo starts. Existing local config files are not a fallback:
they cannot silently change which Firebase configuration a commit builds with.
The config is fetched on each invocation, so the default path requires network
access. The lock file pins Firebase configuration, not every input needed for
byte-identical Android artifacts; the toolchain, dependencies, frontend configuration, and
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
contain `com.macro.workspace.mobile`, the current Android package. Other Firebase project
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
   (for example, `GOOGLE_SERVICES_JSON_V3`). Keep every older pinned key unchanged
   so older commits remain buildable. Pass the value through stdin, not a command
   argument, and suppress command output to avoid printing it:

   ```sh
   doppler secrets set GOOGLE_SERVICES_JSON_V3 --project android-release --config prd < /path/google-services.json > /dev/null
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

### Production Firebase project setup

The production Android app is registered as `com.macro.workspace.mobile` in
`macro-app-prod`; development uses `macro-app-dev-12ae0`. The Google services
Gradle plugin and Firebase Messaging SDK are already integrated. The console's
generic SDK snippets do not need to be added again.

The downloaded `google-services.json` configures the Android client only. The
notification backend delivers Android pushes through an AWS SNS platform
application, whose FCM credential must belong to the same Firebase project.
For production, store the new project's service-account JSON securely in the
AWS Secrets Manager secret selected by `notification-service:fcm_secret_key`
(`fcm-credential-prod` in `Pulumi.prod.yaml`), then update the notification-service
stack so its SNS platform application receives the credential. Do not deploy a
credential replacement until existing Android installations using the former
Firebase project have been accounted for; their tokens belong to that project.
Verify real push delivery after the change. The client config alone cannot prove
the backend is configured or that delivery works. Never commit or print a
service-account private key.

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

App Links require a domain association for `com.macro.workspace.mobile` and the certificate
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
adb shell pm verify-app-links --re-verify com.macro.workspace.mobile
adb shell pm get-app-links com.macro.workspace.mobile
adb shell am start -W -a android.intent.action.VIEW -c android.intent.category.DEFAULT -c android.intent.category.BROWSABLE -d 'https://dev.macro.com/app/task/TASK_ID'
```

Adding `-p com.macro.workspace.mobile` tests routing but does not prove domain verification.
Test cold/warm links, auth cancellation/retry, email-code login, relaunch with a
session, logout/account switching, and entity links through login. Repeat with
signed release builds and actual provider sign-in.

### Publishing associations

Publication procedure for the hosting owner:

1. Recheck the chosen hostname's DNS, valid HTTPS certificate, CDN aliases and
   `/.well-known/*` origin. Confirm the endpoint returns HTTP 200 with JSON
   directly, without a redirect or an HTML fallback.
2. Obtain the SHA-256 **app-signing** fingerprint from Play Console for
   `com.macro.workspace.mobile`. The upload certificate is only suitable for testing
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
[native compatibility contract](../../apps/web/tauri/src-tauri/README.md).

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

Background then use `adb shell am kill com.macro.workspace.mobile` and verify the PID
has disappeared for normal process death. Force-stop/relaunch is a separate case.
Use `adb shell am start -W -n com.macro.workspace.mobile/.MainActivity` for launch timings,
`adb shell dumpsys meminfo com.macro.workspace.mobile` for PSS, and Perfetto/Android Studio
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

## Native calling

Channel calls use the Android `call-kit` plugin with a self-managed Telecom
`ConnectionService` and a native LiveKit room. The WebView observes that room;
reloading or navigating the web UI does not create another media session.
Native calls require Android 8/API 26 or newer and an installed binary that
advertises the call-kit plugin. Android 7 and older installed binaries keep the
browser call controls, including when they receive a newer frontend OTA bundle.

The existing Android push registration supplies the FCM endpoint and advertises
`nativeCallCapable` only when the installed binary and OS support native calls.
Existing registrations default to false and keep ordinary call alerts until a
capable app re-registers. Deploy the device-capability migration before services;
deploy the notification ingress and call-producing services before enabling the
new client registration. Native delivery suppresses ordinary alerts only for the
platform and capable Android endpoints it handles, so another device can still
receive its fallback alert.

Call pushes are data-only, high priority, have a 60-second TTL, and include a recipient-specific
LiveKit token and HTTPS ring-status URL. The receiver checks the registered
account and message age. Tokens are kept in memory and never logged or persisted.
A dropped call push logs its reason under the `MacroCall` logcat tag (another
account, invalid payload, stale, recently ended, or another call active).
While ringing, the native coordinator polls the existing ring-status endpoint;
answering rechecks it before connecting. Answered-elsewhere, cancelled, expired,
and invalid-token rings are dismissed. Transient verification failures allow a
retry but cannot authorize an answer. Logout/account switching ends native calls.

The **Calls** notification channel presents Answer/Decline and an ongoing End
call action. Telecom handles headset/system actions and coordinates interruptions.
Android's full-screen-intent setting controls whether a locked phone opens the
call activity automatically; when unavailable, the call notification remains the
entry point. Android 14+ revokes it by default for Play installs unless the Play
Console's full-screen intent declaration names calling as core functionality;
check with `adb shell appops get <package> USE_FULL_SCREEN_INTENT`. Once
notifications are on, Macro shows a toast while the setting is off; **Allow**
opens Android's per-app setting, and the toast stays until returning to Macro
finds access granted; **Hide** stops the prompt on that device. The
call notification is public, so the lock screen shows the call and its actions.
Test both permission states. Microphone access is required to join;
camera access is requested when enabling video, and Bluetooth access when selecting
that route on Android 12 or newer. A denied permission does not silently enable
capture.

The native call activity presents a themed drawer at approximately 92% of the
safe screen height, above navigation bars/cutouts. A large participant tile sits
above a horizontally scrolling participant strip; tapping a strip tile selects
it as primary. Agent participants such as the transcriber are hidden. Speaker,
Mute and Video form a labelled control row of Phosphor icons, with Leave in the
header and camera switching on the primary local video tile. Hold Speaker to
select headset/Bluetooth routing.

As on iOS, Back, tapping the scrim, or swiping the handle down shrinks the drawer
to a thumbnail over Macro (you on the left, the active speaker on the right).
Tapping it reopens the drawer, dragging snaps it to a corner, and dragging it
past a side tucks it away; once someone else is in the call an edge tab brings
it back, and **Open call controls** reopens the drawer. On a locked phone the drawer
goes straight to PiP where the device supports it. Leaving Macro continues the call in system PiP:
from the thumbnail, Macro's main activity enters PiP (auto-enter on Android 12+,
which needs `android:supportsPictureInPicture` on `MainActivity`) and hides the
WebView so it keeps its size; from the drawer, the drawer enters PiP and
reopens when Macro returns. PiP uses the same layout as iOS, its menu offers
Mute and Leave, and expanding it reopens the drawer. A tap on a system PiP
always shows Android's menu first. Audio continues in the foreground service
while backgrounded; camera capture stops once neither the drawer, the thumbnail
nor PiP is visible. The web call controls can also reopen the drawer.

After a debug build generates Tauri's Gradle includes, run the plugin unit tests
from `tauri/src-tauri/gen/android` with
`./gradlew :tauri-plugin-call-kit:testDebugUnitTest`. Run
`./gradlew :tauri-plugin-call-kit:connectedDebugAndroidTest` for native
Telecom/foreground-notification instrumentation on an emulator or device.
These tests use synthetic offers to check screen-on/off incoming presentation,
decline/redelivery and stale/account filtering without connecting media. Shared tests run
with `bun run test src/features/channel/Call/tests` from `apps/web`. Backend
notification tests require the local SQLx test database described in
[database.md](database.md), with `SQLX_OFFLINE` unset.

For isolated native media testing, run a local LiveKit server in `--dev` mode
bound to `0.0.0.0`, then add
`-Pandroid.testInstrumentationRunnerArguments.livekitUrl=ws://10.0.2.2:7880`
to the connected-test command on the standard Android emulator. The optional
media tests use LiveKit's development credentials, a second native participant,
and emulator microphone/camera permissions to verify video subscription, mute,
camera start/stop, duplicate start, network interruption/reconnect, navigation/PiP,
the in-app thumbnail and its PiP handoff (`MiniWindowTest`, Android 12+), and
resource cleanup. Cleartext
access is enabled only in the instrumentation APK. This test does not validate
production FCM delivery or hardware audio quality.

Hardware qualification is still required on Pixel and Samsung. For each device,
record Android version, APK revision, permissions, route/accessory and results:

| Flow | Required checks |
| --- | --- |
| Incoming | Foreground, background, locked, ordinary process death; answer, decline, timeout; full-screen permission allowed/denied |
| Outgoing | Foreground start, lock/background after connecting, end from app/notification/headset |
| Ring coordination | Caller cancels, answer on another device, duplicate/delayed push, logout/account switch while ringing |
| Audio | Microphone denied/revoked, earpiece/speaker, wired headset, Bluetooth connect/disconnect, cellular-call interruption |
| Lifecycle | Wi-Fi/cellular transitions, temporary offline/reconnect, navigation, WebView reload, foreground resume, no duplicate participant |
| Video | Camera denial, front/back switch, remote video, supported PiP, PiP dismissal, background without PiP, end and reopen; granting camera permission for an ended call must not enable video on a replacement call |
| In-app thumbnail | Drawer to thumbnail and back, drag to each corner, edge tab, leave the app into PiP (Android 12+ and older), expand PiP to the drawer, close PiP, call ending in PiP |

A local build or JVM/shared-state test does not prove this hardware matrix. Play
installation/distribution regression belongs to release workstream 07.
