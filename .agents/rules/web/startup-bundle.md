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
- Each top-level route picks its shell in `app-router-view.tsx`
  (`routes/shells.tsx`): `authRoute` pages and booking links render without app
  chrome, and `appRoute` renders `AppShell` — the app's providers
  (`AppProviders`), chrome (`AppChrome` in `Layout.tsx`), and the split layout.
  Put state only the app's views use in `AppProviders`, not `Root`; `Root` keeps
  what every page or a call needs.
- `index.html` paints a boot shell before any JS runs: the saved theme's
  background, the rail column, and the desktop app's content card — no app
  content. The first shell to mount dismisses it (`dismissBootShell`). Keep its
  rail width and desktop inset in step with `SidebarRail` and `SplitLayout`.
- Do not register an asset-caching service worker. Keep `public/sw.js` at its
  deployed URL so existing workers can update, clear their shell and asset
  caches, and unregister; it must not intercept requests.
- The build fails if any emitted file exceeds CloudFront's 10 MB compression
  limit; split it rather than raising the limit.
