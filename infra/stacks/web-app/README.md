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

The routing Lambda depends on entrypoint publication. Updating it independently
could expose HTML naming an asset that still returns 403. Every Lambda HTML
response, including preview failures, uses `no-store`. Pruning waits for the
Lambda too; a failed publication must leave the previous build reachable.

The existing `sync-assets-command` and `index-html-object-metadata-command`
resource identities are retained even though publication now copies entrypoint
bytes with their final headers instead of patching metadata afterward.

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
bun run test --project scripts scripts/publish-web-assets.test.ts scripts/cache-wasm/upload-brotli-to-s3.test.ts scripts/retain-recent-builds.test.ts
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
