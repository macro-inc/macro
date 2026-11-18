# Web app delivery

Pulumi project `macro-web-app` publishes the web bundle to S3 and supplies the
routing Lambda used by the `website-infra` CloudFront distribution. Development
is served at `https://dev.macro.com/app`; production is `https://macro.com/app`.
Deployment requires explicit authorization; tests below do not contact AWS.

## Publication order

The resource dependency graph, not TypeScript declaration order, enforces:

```text
immutable assets + native archive
              ↓
HTML, manifests, version files, and service-worker retirement script
              ↓
routing Lambda with the new HTML
              ↓
old WASM pruning → retained-build pruning
```

`apps/web/scripts/publish-web-assets.sh` owns the two S3 publishing phases:

- `assets`: upload compressed cache WASM at its original key, then static assets
  with `public, max-age=31536000, immutable`. Copy rather than sync so unchanged
  objects also receive the correct metadata after earlier deployments that relied
  on CloudFront headers. Do not delete previous builds during upload.
- `entrypoints`: publish `*.html`, `*.json`, `*.txt`, and `sw.js` with `no-store`,
  only after the assets and managed native archive are ready. The stable
  `app-archive.zip` is managed separately with `no-store`.

The native archive (`app-archive.zip`, the OTA bundle) is staged from its own
copy of the build without the cache WASM Brotli sidecar or source maps. Native
apps' PostHog exception frames are rewritten to the public web copies, whose
published maps still resolve them. Web delivery and the deploy workflow's
Datadog upload keep every map.

The archive also leaves out `web-hosted/`. Vite writes imported videos there
(`assetFileNames` in `apps/web/vite.base.ts`); they publish with the other
immutable assets, and the native apps load them from this deploy
(`webHostedUrl`) instead of carrying them in every binary and update. Their
names carry a content hash, and retained-build pruning never deletes them, so
an app stuck on an older bundle still finds its videos.

The routing Lambda depends on entrypoint publication. Updating it independently
could expose HTML naming an asset that still returns 403. Every Lambda HTML
response, including preview failures, uses `no-store`. Pruning waits for the
Lambda too; a failed publication must leave the previous build reachable.

The existing `sync-assets-command` and `index-html-object-metadata-command`
resource identities are retained even though publication now copies entrypoint
bytes with their final headers instead of patching metadata afterward.

## Bundle identity and retention

`bundle-stamp` (`tooling/bundle_stamp`) writes `bundle-manifest.json` in every
build. Its `bundleBuild` is the source commit's time in milliseconds, so every
build of one commit, including the bundle a native release embeds, has the same
identity, and native apps take an OTA bundle only from a newer commit. The
deploy workflow checks the built bundle is stamped from the commit it deploys
(`bundle-stamp verify`).

Because the identity follows the commit, redeploying the same commit (say with
a fixed build secret) reaches web users but no native app that already took the
first build of it; ship the fix as a new commit and release instead. Apps
already stuck on the broken build can be moved off it with a `revoke` rule (see
below).

Retained-build pruning names each record after `builtAt`, when that build ran:
re-running the deploy of one commit publishes new chunks under the same
`bundleBuild`, and the earlier run's open tabs still need theirs.

## Rolling back

Roll back forward: revert the bad commit on `main` and cut a release. Native
apps refuse a bundle from an older commit than the one they run, so redeploying
an older commit reaches web users but not apps that already took the bad bundle.

A production deploy whose bundle is older than the live one fails: the build
job's `Verify bundle identity` step checks it, and the deploy job's `Check
bundle against live` step checks it again right before Pulumi publishes, so a
deploy-only re-run of an older release fails too. Two deploys publishing at the
same moment can still both pass; the check narrows that window, it does not
lock it. To redeploy an older commit anyway, dispatch **Deploy Web App** with
`environment: prod` and `rollback: true`; a release event cannot skip either
check. To move native apps back as well, add a `revoke`
rule to the authentication service's bundle update policy
(`BUNDLE_UPDATE_POLICY_JSON`, see `crates/native_app_service`) covering the bad
range, with bounds from `cargo run -p bundle_stamp -- number <sha>`. Revoked
apps clear their OTA bundle, fall back to the embedded one, and then take the
redeployed bundle if it is newer than their embedded build.

Never roll production back to a commit from before `bundle-stamp`: its manifest
is numbered by build time, which outranks every stamped bundle, and updaters
that read only stamped manifests are never offered it.

The first stamped production deploy compares its commit time with the live
legacy manifest's build time, so it must come from a commit made after the last
legacy production build ran; otherwise the verify step fails. Apps on that
legacy bundle likewise take the first stamped bundle whose commit is newer than
its build.

## CDN policy

[The website stack](../website/README.md#app-cache-policy) owns browser and edge
cache policy. Static errors default to `no-store`; only successful objects with
explicit metadata receive a long lifetime. Prefer deploying this publisher before
the CDN policy so existing objects already have their metadata. Neither change is
deployed by running the checks below.

Policy changes cannot evict a failed response already cached in a browser with
one-year freshness. Such sessions need a new asset URL/build or targeted browser
revalidation; a CloudFront invalidation alone cannot clear browser caches.

## Checks

From the repository root:

```sh
\cd apps/web
bun run test --project scripts scripts/publish-web-assets.test.ts scripts/cache-wasm/upload-brotli-to-s3.test.ts scripts/retain-recent-builds.test.ts scripts/web-hosted.test.ts
\cd ../../infra
bun run check  # Type-checks both projects and runs the web-delivery tests.
```

The publisher tests use a local fake S3 CLI, including failure and unchanged-byte
cases. The Pulumi mock monitor verifies actual resource dependency edges; source
order assertions are not sufficient. `publication.test.ts` suppresses local staging
commands and does not execute cloud commands. `bun run test:web-delivery` runs
just these infrastructure regressions. It keeps Pulumi mock files in separate
processes because their runtime configuration is process-global; CI invokes it
through `bun run check`.
