# Public website in the app repository

The feature pages, pricing, partner program, migration guide, legal pages, blog,
illustrations, fonts, demos, and static prerenderer were migrated from `solid-site`.
No build or runtime imports reach outside this repository. The source repository
is left intact until the public deployment has been switched and verified.

The shared header and 20px feature dock live in `../src/features/marketing/`.
The public journey shares the setup components in `../src/features/setup/`.
Public tool selections are preview preferences, not authenticated connections;
account creation and real OAuth connections remain in `/app/onboarding`.

## Develop

Run the normal `apps/web` dev server. One origin serves:

- `/` and `/start`: resumable public journey (the old `/onboarding-preview.html`
  review URL also works).
- `/email`, `/tasks`, `/channels`, `/documents`, `/calls`, `/crm`, `/agents`,
  `/github`: original feature pages with shared chrome.
- `/pricing`, `/partners`, `/posts`, `/migrate`, and legal/related routes:
  migrated marketing pages.
- `/app/*`: existing authenticated application.

Navigation across the two document entries intentionally loads a new document:
the marketing page styles and the app's Tailwind reset never leak into each
other. Public progress, search, selections, and carousel choice persist in a
versioned local-storage record. Actual authenticated setup retains its per-user
session step, server-backed connections, and per-account team draft. No preview
selection is represented as a server-side OAuth connection.

## Build

From `apps/web`, install the build browser once with `bunx playwright install chromium --only-shell`
(on Linux CI, add `--with-deps`). `bun run build:site` writes `dist-site/` with
32 prerendered pages, SEO metadata, blog routes, sitemap, original assets, and the
separate noindex `/start` journey. Feature/blog pages use Solid SSR; the homepage
is snapshotted from the actual UI in Chromium with external requests blocked.
The build ends with the SEO migration checks.
`bun run build:all` builds both the authenticated app and public site.

For hosting, serve `dist-site/` at the origin root and the existing `dist/` at
`/app/`. Resolve public extensionless paths to `<path>/index.html`; retain the
existing `/app/*` SPA fallback. A plain static host needs no separate site repo.
The existing cloud deployment has not been changed by this migration. Run
`git lfs pull` before building to fetch the migrated video assets.

Validate with `bun --bun ../../node_modules/typescript/bin/tsc -p marketing/tsconfig.json`,
the public journey tests, `just check`, and browser comparisons against the live
feature pages. Keep the prerender route list and development route mapping in
sync when adding a page.


## SEO migration gate

See [the migration audit and cutover checklist](seo/MIGRATION.md). The committed
`seo/migration-baseline.json` records the 30 indexable URLs and schema types on
macro.com as of September 23, 2026. Keep this baseline when adding pages; do not
remove a URL from it to silence a regression.

- `bun run check:seo`: verify the built artifact, metadata, schema, sitemap,
  internal links, signup noindex, and a 400 KB gzip initial-JavaScript budget.
- `bun run check:seo:live https://candidate-host`: verify direct HTTP responses,
  static HTML, canonicals, crawler files, and real 404s at the deployed edge.
  `VITE_APP_BASE_URL` sets the expected canonical origin (default macro.com).

The existing app deployment builds only the authenticated app. It does **not**
publish `dist-site`. The public cutover must upload this directory to the current
website origin while retaining the CDN's app, Ghost resources, and OIDC routing.
Installing Chromium and running `build:site` are required in that deployment job.
