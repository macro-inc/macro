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

From `apps/web`, `bun run build:site` writes `dist-site/` with 31 prerendered pages,
SEO metadata, blog routes, sitemap, original assets, and the journey entry.
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
