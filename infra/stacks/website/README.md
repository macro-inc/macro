# Website

Pulumi project `website-infra` (stacks `macro-inc/dev`, `macro-inc/prod`). It
publishes `apps/marketing/dist` to S3 and owns the macro.com CloudFront
distribution: the public site, `/app` routing to the web-app stack, `/.well-known`
OIDC, `resources*` to Ghost, and the `www`/`chat`/signed-in-root redirects in
`wwwRedirect/handler.js`.

Moved from `macro-inc/solid-site/infra`; project and stack names are unchanged,
so this program manages the existing resources.

## Deploy

`.github/workflows/deploy_website.yml` deploys dev on pushes to `main` that touch
the site or this stack, and prod from `release-production`. Run it manually from
the Actions tab to deploy `dev`, `prod`, or `both` (dev first; prod is cancelled
if dev fails). To preview locally:

```sh
cd apps/marketing && VITE_APP_BASE_URL=https://dev.macro.com bun run build
cd ../../infra/stacks/website && bun run preview:dev
```
