---
description: "Keep the web startup bundle small: views, blocks, and modals load lazily."
paths:
  - "apps/web/src/**"
  - "apps/web/index.html"
globs: "apps/web/src/**,apps/web/index.html"
alwaysApply: false
---

# Startup bundle

- Everything statically reachable from `src/index.tsx` downloads and runs before
  the first screen. Views, block components, and modals load through `lazy()` /
  `lazyNamed` (`@core/util/lazyNamed`) inside a `<Suspense>`; never statically
  import one into a shared hub (`Root`, `Layout`, `AppProviders`,
  `componentRegistry`, `app-router-view`, `routes/shells.tsx`, block
  `definition.ts`, Lexical `init.ts`).
- A `route-views.tsx` imports the view it renders statically. The warm-up and
  the router preload only the route's own chunk, so a view behind a second
  `lazy()` stays cold and its first open shows the route skeleton however long
  the app has been running. Keep a `lazy()` there only for a view the route
  rarely picks, with an `ast-grep-ignore` comment that says why. Enforced by
  ast-grep `tsx-route-views-static-view`, CI error.
- Web warms `LIKELY_NEXT_VIEWS` at idle. The native apps read chunks from their
  own bundle, so they also warm `OTHER_APP_VIEWS`; add a new app view to one of
  the two lists in `routes/lazy-route-views.ts`.
- Each top-level route picks its shell in `app-router-view.tsx`
  (`routes/shells.tsx`): `authRoute` pages and booking links render without app
  chrome, and `appRoute` renders `AppShell` — the app's providers
  (`AppProviders`), layout/context owner (`SplitLayoutProvider`), chrome
  (`AppChrome` in `Layout.tsx`), and split content. Compose these in the route
  shell; keep `AppChrome` independent of page selection. Put state only the app's
  views use in `AppProviders`, not `Root`; `Root` keeps what every page or call needs.
- `index.html` paints a boot shell before any JS runs: the saved theme's
  background, the rail column, and the desktop app's content card — no app
  content. The first shell to mount dismisses it (`dismissBootShell`). Keep its
  rail width and desktop inset in step with `SidebarRail` and `SplitLayout`.
- Read a supported iOS notification launch intent before mounting the router;
  keep startup payload validators in the generated compact push-schema entry
  rather than importing the full service schema bundle.
- Do not register an asset-caching service worker. Keep `public/sw.js` at its
  deployed URL so existing workers can update, clear their shell and asset
  caches, and unregister; it must not intercept requests.
- The build fails if any emitted file exceeds CloudFront's 10 MB compression
  limit; split it rather than raising the limit.
- The build also fails if a chunk with source code has no source map or a map
  exceeds PostHog's 25 MB symbolication limit. `startupChunks()` in
  `vite.base.ts` splits the code each HTML entry loads into `vendor-<n>`,
  `api-schemas-<n>`, and `startup-<entries>-<n>` chunks of about
  `STARTUP_PART_CODE_BYTES` of module code (a single module or an import cycle
  stays whole), cut along the import order so they never import each other in
  a cycle; the build fails if they do. It moves only modules an entry already
  imports. Don't use Rolldown's `maxSize` for startup groups; its parts import
  each other in cycles.
