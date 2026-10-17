# iOS releases and breaking Tauri changes

(The Android counterpart — `android-update`, `Android Native Check`, Google
Play as the source of truth — is described in `docs/development/android.md`.)

Web bundles ship to installed apps over the air (see
`tauri/macro_bundle_updater_plugin`), but native code — anything under
`apps/web/tauri/` — only reaches users through the App Store. A bundle that
depends on new native code must therefore never be deployed before the
matching native build is downloadable, and users on older native builds must
be pushed to update before they receive that bundle.

Four generated workflows (plus a gate job in the web app PR checks) and a
checked-in `min-native-build.json` enforce this end to end.

## The flow for a PR with breaking native changes

1. **`iOS Native Check`**, a job of the web app PR checks
   (`.github/workflows/web-app-check-main.yml`), runs on every PR against
   `main`. The required `Web App Status Check` depends on it, so no branch
   ruleset change is needed. If the PR touches the iOS native code (see
   "What counts as native code" below) it requires:
   - the iOS release numbers to be bumped relative to `main`, and
   - that exact version + build to be **live on the App Store**.

   Until both hold, the check fails and the PR cannot merge.
2. You bump the numbers locally and commit the result:

   ```bash
   cd apps/web && doppler run --project ios-release --config prd -- just ios-bump
   ```

   This bumps the build number in `tauri/src-tauri/tauri.ios.conf.json`,
   raises the `ios` floor in `min-native-build.json` to it, syncs the
   generated Apple project metadata, and bumps the marketing version
   (`2.0.9` → `2.0.10`) **only if the committed one has already shipped** —
   a version that was never released, or whose submission was withdrawn,
   keeps its string and just gets a new build. The build number is one above
   the larger of the committed number and the highest build App Store
   Connect has ever seen, which is why the command runs through Doppler: a
   release made by hand (Xcode Organizer, `just ios-release`) whose number
   was never committed would otherwise be reused, and the floor derived from
   it would be wrong. Without credentials the bump still runs but warns (and
   bumps the version unconditionally); the release workflow re-checks the
   number against App Store Connect before building and fails with a re-bump
   instruction if it collides.
3. Add the **`ios-update`** label to the PR — once it is ready to merge: the
   **`iOS App Store Release`** workflow
   (`.github/workflows/ios-app-store-release.yml`) first refuses drafts and
   PRs with failing checks (pending ones are waited on, up to 30 minutes), then builds the app from
   the PR head on the Namespace macOS runner inside the Nix dev shell (like
   the `ios-preview` label), uploads it to TestFlight, waits for App Store
   Connect processing + export compliance, and submits it for App Review
   (release type: automatic after approval). It comments the outcome
   on the PR. To merge the moment Apple approves, click **Enable
   auto-merge** (squash) on the PR: GitHub then merges it as soon as
   `iOS Native Check` passes. (The workflow doesn't enable auto-merge
   itself: that would need a user token, because a merge set up by the
   Actions token doesn't trigger the push-to-`main` workflows such as the
   dev redeploy.) To retry after a failure, remove and re-add the label.
4. Wait for Apple to approve. The version releases automatically, and the
   **`iOS Release Watch`** workflow (`.github/workflows/ios-release-watch.yml`,
   every 30 minutes) notices: for each open PR labeled `ios-update` it asks
   App Store Connect whether the version + build at the PR head is live and,
   when it is, re-runs the PR's failed `iOS Native Check` job and comments. The
   gate turns green on its own and the PR merges if auto-merge is on.
   (Re-running the job by hand works too. The watcher stops after two
   automatic re-runs — counted by its own comments on the PR — so a check
   failing for another reason doesn't retry forever, and GitHub refuses to
   re-run runs older than 30 days: after a review that long, push a commit to
   get a fresh run.)
5. The next prod web deploy (`just build-prod`) reads both platform floors
   from `min-native-build.json` into `MIN_NATIVE_BUILD_ANDROID` /
   `MIN_NATIVE_BUILD_IOS`, so `dist/bundle-manifest.json` carries
   `minNativeBuilds.ios` = the new build number. Installed apps on older
   native builds stop applying OTA bundles and show the "update from the
   App Store" prompt instead (`NativeUpdateRequired` in
   `src/lib/tauri/TauriProvider.tsx`). The Android floor is independent; see
   `docs/development/android.md`.

The bump is deliberately a local command rather than something the label
workflow pushes: a `GITHUB_TOKEN` push never re-triggers required checks, so
a CI-pushed bump commit would wedge the PR.

### Non-breaking tauri changes

If the tauri change doesn't break the native/web contract (comments, dev-only
tooling, desktop-only config), add the **`skip-ios-update`** label instead;
the **`iOS Native Check Label`** workflow re-runs just the gate job (and the
status check that depends on it) when that label is added or removed, so the
gate passes without a release and without re-running the whole web suite.
That workflow is not a required check: it waits for the web suite run to
finish first (up to 25 minutes), and the release preconditions ignore it. For a non-breaking change you still want
to ship to the App Store, `just ios-bump --no-min` bumps the versions without
raising the floor.

## What counts as native code

Two things:

- **`apps/web/tauri`**, minus what never reaches the iOS binary: anything
  Android-only by Tauri's naming convention (a path component `android`,
  `android_*`, `android.*` or `*.android.*` — the `android_*` plugins, every
  `android/` directory, `android.rs`, `tauri.android.conf.json` and so on),
  `desktop-release.json`, and `.helix/`.
- **A bump of the client cache wasm package version** in
  `crates/client/cache-wasm/Cargo.toml`. The app compiles the cache crates
  (`crates/client/cache-core`, `cache-turso` and what they pull in)
  natively through the GraphQL cache plugin, so a cache change ships to
  iOS only through the App Store. Rather than treating every edit under
  `crates/client` as native, the gate uses the version the team already
  bumps when a cache change must ship: a PR that moves it (compared with
  the base branch on the merge ref) is a native PR, and the version is part
  of the provenance hash, so a build is only "live" for the version it was
  built with. The Android gate and release apply the same rule through
  `scripts/android-native.mjs`.

The hash recipe is defined once, in `scripts/ios_native_tree.sh` next to the
workflow sources, mirrored in `ios-app-store.mjs`; the gate's change
detection uses the same exclusions and the same version comparison.

## Several native PRs at once

Version + build number alone don't identify a PR's native code: two PRs
bumped from the same `main` get the same numbers. So the release stamps each
uploaded build with a hash of the native code it was built from (in the
build's TestFlight "What to Test" text), and the checks use it. "Native
code" is defined above. The checks:

- **Collision check** (release workflow, before building): the
  marketing version must be above the latest App Store release, and a
  build at or above the PR's number with a different stamp — another PR, or
  a hand release — fails with "re-bump". The PR's own earlier upload (same
  version, same stamp) is a retry: the release skips the build and goes
  straight to submit.
- **Up-to-date check** (release workflow, before building and again before
  submitting): the head's native tree must equal that of the PR's merge
  result. A head that lacks native code `main` gained since it branched
  would go through App Review but could never pass the gate; the release
  refuses instead, and the fix is to merge `main`, bump, and re-add the
  label.
- **Live check** (the gate): the live build's stamp must equal the native
  tree of the PR's **current merge result** (fetched through the API, so a
  re-run of the job evaluates today's `main`, not the one the run started
  with).
  Native commits pushed after the release, native code that landed on main
  since (merge main into the PR), or another PR's build that shares the
  numbers, all fail with "bump and re-release": the floor the merge would
  set must describe a build that really contains main's native code.
  Web-only (and Android-only) commits don't change the hash and stay green.
  The flip side: any merge to `main` that touches the iOS native code while
  a release is in review (even a `skip-ios-update` one) changes the merge
  result's hash, so that release has to be bumped and redone after merging
  `main`.
- **One version in flight**: App Store Connect allows one iOS version in
  review at a time, so the second PR's `submit` fails naming the version
  that blocks it. Once that one ships (or is removed from review in App
  Store Connect), remove and re-add `ios-update`; the uploaded build is
  reused. A rejected or abandoned submission blocks everyone until someone
  removes it from review.

In practice: native PRs ship through Apple one at a time, each with its own
number, and the first to release wins its number; the others are told to
re-bump at the earliest check that can know.

## Pushing to a PR after the label

The label means "release this and merge it when Apple approves", so the
release only starts on a PR that is ready to merge. Pushes afterwards:

- **Web-only commits** need nothing. The native tree is unchanged, the gate
  stays green, and the reviewed build's embedded web bundle is replaced over
  the air after the merge like every other OTA update.
- **Native commits** make the uploaded build stale, and a stale build Apple
  approves would go straight to the App Store. The
  **`iOS Release Drift`** workflow (`.github/workflows/ios-release-drift.yml`)
  runs on every push to a labeled PR and, when `apps/web/tauri` changed,
  cancels any release run still building, withdraws the PR's submission from
  review (the API equivalent of "Remove from Review"), removes the
  `ios-update` label, and comments. GitHub does not run `pull_request`
  workflows on a PR that conflicts with `main`, so a native push to such a
  PR is caught by the watcher instead, within half an hour: it compares the
  in-flight build's stamp with the head's native code and does the same
  withdrawal. The release itself also refuses to
  submit if the native tree moved while it was building, on the PR or on
  `main`. To continue: bump
  (the marketing version stays, the build number moves), commit, push, and
  re-add the label; `submit` takes the withdrawn version record over, so no
  App Store Connect visit is needed. If Apple had already approved the stale
  build (with automatic release that means it is live or minutes away),
  nothing can be withdrawn: the comment says so, and the follow-up release
  should ship as soon as possible.

## Credentials note

The gate and the watcher run `ios-app-store.mjs` from the PR's own merge
result with the same App Manager key the release uses, on every same-repo
PR with native changes (fork PRs get no secrets and fail the gate closed).
A collaborator branch could therefore drive App Store Connect with that
key. If that matters, give the gate a second, Developer-role key in Doppler
(reads suffice for `status`); the watcher's `withdraw` needs App Manager.

## Manual / TestFlight-only releases

`just ios-release` still does a full local build + TestFlight upload without
any Xcode UI (it bumps only the build number). **Commit the bumped number**,
whichever way you release — the automated flow treats the committed build
number as the newest native code, and `just ios-bump` only catches an
uncommitted one when it can ask App Store Connect. It uses the
same toolchain split as `just ios-build` (`scripts/ios-native-env.sh`), so run
it from the Nix dev shell like any other iOS build. See the header of
`scripts/ios-release.sh` for the credentials it needs (`doppler run --project
ios-release --config prd -- just ios-release` covers them), and
`scripts/ios-app-store.mjs` for the underlying App Store Connect commands
(`wait-build`, `submit`, `status`).

`just ios-build` and `just ios-release` export frontend traces and logs to the
production OTLP proxy
(`ios_production_telemetry` in `scripts/ios-native-env.sh`); set
`VITE_OTEL_EXPORTER_URL` and `VITE_OTEL_ENV` to send them elsewhere.

## One-time repository setup

- **Labels**: create `ios-update` and `skip-ios-update`.
- **Branch protection**: nothing to do — the gate is a job of the web app PR
  checks, and the already-required `Web App Status Check` fails when it
  fails.
- **Doppler project `ios-release`, config `prd`** (same shape as
  `macos-release/prd`, which the desktop notarization uses; that key has only
  the Developer role, which cannot submit for review, hence a separate key):
  - `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_API_PRIVATE_KEY` — an App
    Store Connect team API key with the **App Manager** role (Users and
    Access → Integrations → Team Keys) and the contents of its
    `AuthKey_<ID>.p8`
  - optional `APPLE_DISTRIBUTION_CERTIFICATE_BASE64` /
    `APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD` — a base64-encoded Apple
    Distribution `.p12`; without it the release workflow relies on Xcode
    cloud signing through the API key.
- **GitHub secrets**:
  - `IOS_RELEASE_DOPPLER_TOKEN` — a Doppler service token with read access to
    `ios-release/prd`, used by the iOS workflows
  - `POSTHOG_API_KEY` (already present) — embedded as `VITE_POSTHOG_API_KEY`
    in the release build
