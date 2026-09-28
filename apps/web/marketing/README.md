# Standalone public website

This directory owns the Macro public website and its public signup introduction.
It shares the repository with the authenticated application, but has its own
package manifest, Vite entry points, TypeScript aliases, styles, assets, and UI
components. Application UI changes must not alter the website.

## Ownership and dependency boundary

- `src/features/marketing/`: homepage, feature demonstrations, navigation, and
  website interactions.
- `src/features/setup/`: public signup introduction and local preview selections.
  Account creation and authenticated onboarding continue in `/app`.
- `src/ui/`: frozen website versions of the small UI primitives used by demos.
- `src/app/`: public feature, pricing, legal, and blog pages retained from the
  original website. Despite the historical directory name, these are website
  files, not the authenticated application. The `@app/*` alias points here.
- `src/assets/`, `src/styles/`, and `public/`: website-owned illustrations, icons,
  fonts, videos, styling, and other static files.
- `scripts/`: public build, prerendering, SEO, and architecture checks.

Use website-owned files or third-party packages declared in this directory's
`package.json`. Do not import `apps/web/src`, repository `packages`, app aliases
such as `@core` or `@queries`, or `@macro-inc/*` workspace packages. Copy the
minimal presentation component and its necessary assets here before using it.
Avoid copying app providers, authentication state, service clients, or generated
editor bundles. Demos use local fixtures and website-owned state.

The standalone gate checks every source file, including unreachable and
type-only imports, static dynamic imports, glob imports, TypeScript aliases,
CSS imports and content scans, static asset references, and escaping symlinks.
It rejects the old `public/live-editor` compiled app payload. Declaring a
workspace dependency or importing a third-party package absent from the
website manifest also fails the gate. Runtime-generated asset names still require
browser verification. The Vite boundary plugin additionally rejects app and
workspace modules in the resolved production build.

Normal navigation and explicit public endpoints are allowed: links to `/app`,
Google sign-in, and the unauthenticated mobile email handoff do not load app UI.
Public integration selections are preview preferences, not OAuth connections.
Local preview data must not be presented as server-backed account state.
The preview proceeds from integration selection directly to workspace setup;
Back from workspace setup returns to integrations.

## Develop and validate

From this directory:

```sh
bun run dev
bun run check:standalone
bun run type-check
bun run test
bun run build
```

Install workspace dependencies from the repository root first. The public dev
server runs independently of the authenticated app. It serves the homepage,
public feature and blog routes, and `/start`; `/onboarding-preview.html` remains
a development review entry. It does not host the authenticated `/app/*` routes.

Before the first prerender build, install Chromium with
`bunx playwright install chromium --only-shell` (add `--with-deps` on Linux CI).
Run `git lfs pull` when migrated video files have not been fetched. The build
writes the public artifact to `apps/web/dist-site/`, verifies the standalone
boundary, prerenders public pages, and finishes with the SEO migration gate.
The homepage uses Solid SSR and hydration. Build verification checks that its
first-painted heading retains its DOM node and geometry on desktop and mobile,
and exercises navigation and the deferred email demo.

Architecture regression tests create real temporary source graphs, CSS files,
assets, and package symlinks. They verify that valid website references pass
and app imports, type-only leaks, inherited dependencies, external CSS scans,
missing assets, and compiled app artifacts fail. After changes, also run the
repository's `just check` and verify user-visible behavior in a browser.

## SEO and deployment

See [the migration audit and cutover checklist](seo/MIGRATION.md). The committed
`seo/migration-baseline.json` records the indexable URLs and schema types on
macro.com. Keep the baseline when adding pages; do not remove a URL from it to
silence a regression.

`bun run check:seo` verifies the built metadata, schema, sitemap, internal links,
signup noindex, and initial JavaScript budget. The deployment probe is
`bun scripts/verify-seo-live.ts https://candidate-host`.
`VITE_APP_BASE_URL` sets the expected canonical origin (default `macro.com`).

Publish `apps/web/dist-site/` at the public origin, resolving extensionless
public paths to `<path>/index.html`. Preserve the existing authenticated
`/app/*` application, Ghost resources, and OIDC routing at the edge. The existing
app deployment does not automatically publish `dist-site`; the public artifact
needs its own deployment step. Website development and builds do not require
changes to application routes, components, or providers.

## Feature-page pattern

`/email` establishes the public feature-page pattern in
`src/features/marketing/components/FeaturePage.tsx`: homepage slab headings and
rules, Inter body copy, and the onboarding security section’s reading measure
and FAQ disclosures. Website UI utilities and the frozen dark palette are
scoped to `.feature-page`, preserving the surrounding public-page styles.

The email page reuses `HomepageEmailCompose`. Its other local demos freeze the
presentation of the application’s `EmailSidebar`, `SearchBar`, entity email row
layouts, `MessageCard`, share form, channel composer, and linked email cards. They
use website assets and local fixtures; they do not import those app modules.
To verify the page: filter accounts, search and open an inbox thread, move an
update to Noise and undo, share the example into the launch channel, and open
its linked thread. The composer, sharing, and edits stay local. No demo sends
mail or changes a workspace. Playback pauses offscreen and when the page is
hidden; reduced-motion mode shows the completed share. Test pause/replay and
opening a shared email, plus typing and sending a local channel message.

The four feature links have inline SVG illustrations. Full app frames use a
raised rim and a bottom mask into the page background; keep interactive controls
above the faded tail. `HomepageEmailCompose` uses the frozen app composer chrome
on the email page while retaining the existing homepage appearance.

FAQ answers and the collapsed comparison are rendered in the initial HTML.
The comparison uses a native `details` disclosure for both people and crawlers.
Retain FAQ class markers so prerendering emits matching FAQPage structured data.
