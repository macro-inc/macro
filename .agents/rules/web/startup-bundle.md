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
  (`routes/shells.tsx`), which picks chrome only: `authRoute` pages and booking
  links render without app chrome, and `appRoute` renders `AppShell` — the
  chrome (`AppChrome` in `Layout.tsx`) and the split layout. `RootFrame`, the
  router root, mounts `AppProviders` and the dialog host above every shell,
  because onboarding, invite, form, and call pages render app views too. Put
  contexts views read in `AppProviders`, never in a shell or `AppChrome`
  (ast-grep `tsx-app-providers-at-root`, CI error; `routes/shells.test.tsx`
  checks each shell); `Root` keeps what the router and calls need.
- `index.html` paints a boot shell before any JS runs: the saved theme's
  background, the rail column, and the desktop app's content card — no app
  content. The first shell to mount dismisses it (`dismissBootShell`). Keep its
  rail width and desktop inset in step with `SidebarRail` and `SplitLayout`.
- Do not register an asset-caching service worker. Keep `public/sw.js` at its
  deployed URL so existing workers can update, clear their shell and asset
  caches, and unregister; it must not intercept requests.
- The build fails if any emitted file exceeds CloudFront's 10 MB compression
  limit; split it rather than raising the limit.
