# Macro Web App

This is Pulumi IaC for Macro Web App, deploying to AWS S3 and CloudFront Distribution with Route53 and ACM

## Dev Environment
1. Run `just build-dev` from `apps/web/`.
2. Run `$ yarn run deploy:dev` from this directory or `$ yarn workspace @macro-inc/infra-web-app run deploy:dev` from root directory to deploy the build artifact from `apps/web/dist` to https://app-dev.macro.com

## Publication and caching

`apps/web/scripts/deploy/publish-to-s3.sh` uploads the compressed cache WASM
and all other assets before publishing `index.html` and `sw.js`. The routing
Lambda also waits for this command, so neither HTML entry point can reference
an incomplete upload. An asset upload failure leaves both entry points alone.

Publication retains previous content-hashed assets. After both HTML entry
points have published, `prune-retired-assets.ts` records when each unused asset
was first retired in a private `.retired-assets.json` object and removes it
after seven days. Current assets are always protected, including unchanged
files with old S3 modification dates. The first deployment starts a full grace
period for existing files; failed metadata reads or writes stop pruning.

The `website-infra` stack owns CloudFront's cache behavior. App file responses
default to `Cache-Control: no-store`, including errors. A viewer-response
function enables immutable one-year browser caching only for successful
content-hashed assets. `index.html` and `sw.js` also bypass CloudFront's cache.
The distribution's 403/404 error-cache TTL is zero, independently of the
browser headers, so newly available files can be retried at the origin.
The service worker retries a 403/404 once with `cache: reload` to recover errors
stored by the previous CDN policy.

Roll out **both** stacks: `macro-web-app` publishes the ordered build and updated
worker; `website-infra` installs the cache rules. After rollout, verify a hashed
JS URL returns immutable caching, a missing JS URL returns `no-store`, and
`/app/index.html` and `/app/sw.js` return `no-store`. Existing open tabs pick up
the recovery code when their service worker updates.
