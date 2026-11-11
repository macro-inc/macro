# Website

Pulumi project `website-infra` (stacks `macro-inc/dev`, `macro-inc/prod`). It
publishes `apps/marketing/dist` to S3 and owns the macro.com CloudFront
distribution: the public site, `/app` routing to the web-app stack, `/.well-known`
OIDC, `resources*` to Ghost, and the `www`/`chat`/signed-in-root redirects in
`wwwRedirect/handler.js`.

The legacy `chat.macro.com` / `chat-dev.macro.com` redirect hostnames are disabled
by default. Set `website-infra:enableChatRedirect` to `true` for a stack only after
its `certArn` covers the corresponding hostname. This enables both the CloudFront
alias and its Route 53 record; leaving it disabled removes both. CloudFront
validates every alias against the certificate on distribution updates, so an
uncovered chat hostname would block unrelated website deploys.

Moved from `macro-inc/solid-site/infra`; project and stack names are unchanged,
so this program manages the existing resources.

## App cache policy

`/app/*.*` respects the web-app objects' S3 cache metadata. Its response-header
policy supplies `Cache-Control: no-store` only when the origin did not supply a
cache policy, so missing assets cannot acquire an immutable success lifetime.
The existing `Cross-Origin-Opener-Policy: same-origin-allow-popups` is preserved.
The app's edge policy has zero default/minimum TTL and a one-year maximum; common
403/404/5xx responses also have zero error-cache TTL. The marketing site's success
cache policy is unchanged.

The [web-app publisher](../web-app/README.md) sets long-lived metadata on static
assets and `no-store` on mutable HTML, manifests, version files, and the archive.
It publishes assets before entrypoints. Updating CloudFront alone does not repair
already-cached browser errors; affected clients need a new asset URL or browser
revalidation.

Verify after an authorized deployment: entry HTML (including `/app/index.html`)
and missing-asset responses must not receive a one-year lifetime, while a hashed
JavaScript response retains its explicit immutable lifetime. A later published
asset must be reachable without clearing the browser's entire cache.

Backend-free checks, from `infra/`:

```sh
bun test stacks/website/app-cache.test.ts  # Focused CDN policy check.
bun run check  # Includes every web-delivery regression.
```

The mock test constructs the real stack resources without uploading assets or
contacting AWS and checks the policies attached to the app's actual behavior.

## Apex TXT

The prod stack owns the whole TXT set at `macro.com` (SPF, site verifications), as
one resource, retained on delete. Add a value by adding it to the list in
`index.ts`; anything not listed is removed from DNS on the next prod deploy. The
set predates this stack, so it needs adopting into state once, after the code is on
`main` and before the first prod deploy. Importing first would let a release from an
older `main` plan a delete of the whole set; the default `protect` on the import
blocks that, and the first deploy clears it.

From the repo root:

```sh
cd infra/stacks/website
pulumi import --stack macro-inc/prod --generate-code=false --yes --file <(echo '{"resources":[{
  "type": "aws:route53/record:Record", "name": "apex-txt",
  "id": "Z0766278GIHB3CVV9CIL_macro.com_TXT", "version": "6.83.4"}]}')
pulumi preview --stack macro-inc/prod --diff
```

Read that diff before any prod deploy, and stop unless the TXT change only adds the
new value: a list in `index.ts` that went stale would delete a live SPF or
verification value.

## Deploy

`.github/workflows/deploy_website.yml` deploys dev on pushes to `main` that touch
the site or this stack, and prod from `release-production`. Run it manually from
the Actions tab to deploy `dev`, `prod`, or `both` (dev first; prod is cancelled
if dev fails). To preview locally:

```sh
cd apps/marketing && VITE_APP_BASE_URL=https://dev.macro.com bun run build
cd ../../infra/stacks/website && bun run preview:dev
```

## Consolidated website routes

`apps/marketing/seo/page-redirects.json` is the shared permanent-redirect manifest.
The stack injects it into `wwwRedirect/handler.js`; retired pages return 308
responses before directory-index rewrites, retaining query parameters. Browsers
retain existing fragments. Local serving uses the same map, and prerendering
emits noindex redirect fallbacks for static hosts. Deploy this stack with the
website when changing the manifest. The separate `apps/docs/docs.json` records
cover the old docs hostname; publish those only after the destination site is live.

Run the marketing documentation redirect tests and full build before changing
these routes. They verify the edge handler, destination files, old sitemap URLs,
Markdown exports, and link fragments. No deployment is needed for these checks.
