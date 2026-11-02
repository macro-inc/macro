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
- The build also fails if a chunk has no source map or a map exceeds PostHog's
  25 MB symbolication limit. `scripts/startup-chunks.ts` splits independent
  generated data/validation modules and large library owners; use
  `onlyExplicitManualChunks` so their dependencies follow actual feature
  imports. Never coalesce a pre-tree-shaking traversal of all entries into a
  common vendor/schema chunk: unused barrel exports and secondary entries
  would make lazy dependencies eager.

- Generated Zod schema construction stays pure as a complete initializer,
  including nested arguments and fluent chains (`scripts/pure-generated-zod-schemas.ts`
  and its bundling regression). AI tool, storage, notification and startup
  service validators are cached schema getters (`scripts/lazy-zod-schema-codegen.ts`,
  applied by the tool generator and Orval hooks): parsing constructs only the
  requested schema, getters return real Zod objects, and composite validators
  build their inputs at first validation. Never swap object schemas for
  `z.lazy` or construct the whole registry when importing names or types.
- Document key and PDF serialization helpers have their own
  `document-processing-types` entries; importing them must not construct
  protocol validators. The storage client loads the PDF protocol at validation
  and keeps its explicit parent span across that import.
- Install Lexical decorators synchronously at `context/createLexicalWrapper.ts`,
  before the first interactive editor; the context module holds only the
  contract and provider. Never initialize editors from app entry.
- Mention chips, hover cards and preview sheets import the lightweight
  `DocumentPreview` facade and load its body inside the existing preview
  skeleton; static Markdown and its decorator rendering stay synchronous, since
  the accessibility transform runs over the initially rendered DOM.
- Keep mention, equation and media command identities in plugin-owned
  `commands.ts` (media URLs in `plugins/media/source.ts`, image drag payloads in
  `plugins/draggable-block/constants.ts`); renderers must not load plugin
  installation. Block definitions load every component lazily.
- Put composer focus identifiers in their owner contracts
  (`ui/agent-input-constants.ts`, `AI/component/input/constants.ts`);
  navigation must not import composers to focus them.
- Keep interactive agent editors in `block-agent/ui/composer.ts`, outside the
  presentation barrel: unused JSX exports still install delegated events.
- Load sharing UI on demand: the share-dialog opener (`TopBar/shareModal.tsx`)
  loads its body on first open inside its Suspense boundary, `ShareOptions.tsx`
  stays independent of it, block share permissions live in
  `queries/share/block-share-permissions.ts`, and the native share sheet loads
  its composer only for an open batch while Cancel stays available. The
  notification debug UI is reachable only from its lazy route.
- Load Home through `routes/lazy-route-views.ts` with its pending view
  (`features/home/home-pending-view.tsx`) like other top-level routes; Mail must
  not evaluate Home's editor. The mobile page action row loads its composer only
  for the Agents slot, inside the same 48px pending slot; floating create
  actions and keyboard focus stay outside that load.
- Emit the session bootstrap (`scripts/session-bootstrap.ts`) as an independent
  async module entry; ordinary HTML module scripts share one deferred graph in
  Vite. Keep its static closure (`session-runtime`) free of view/query/editor
  implementations, reuse `core/auth/session-refresh.ts`, and run it only with the
  login hint; native startup first installs its transport. Inspect the emitted
  imports when changing it.
- Never preload Loro from boot HTML or the session bootstrap. Markdown's
  load-component owner imports its UI and the Loro singleton together, and
  `core/loro-runtime` starts the WASM fetch at admission; idle block warming and
  router intent share that lazy component. Preparing code or WASM must not
  construct editors, collaboration managers or per-document stores, and entity
  detail target classification (`components/entity-detail/entity-detail-target.ts`)
  stays free of renderer dependencies.
- `core/util/chunk-load-errors.ts` installs its preload-failure listener before
  any speculative import (Solid caches failed lazy imports) and hands one failure
  to the app reload owner; keep recovery UI out of the early entry.
  `lazyNamed` shares one loader promise and primes Solid's cache only on success.
- Root's Channels and EmailLinks contexts create their query observers on first
  data read; boot listeners that capture their APIs must not fetch.
