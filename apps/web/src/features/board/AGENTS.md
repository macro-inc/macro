# Board

## What it is

The Board rail view: Home's desktop Signal feed drawn as a pannable, zoomable
map of what is happening, with several layout variants (V1A–V1E) to compare.
Items open in a modal over the board; read items settle, fade, and leave.

## Start here

- `views/board-view.tsx`: variant picker sidebar, top bar, modal, and
  `VARIANT_VIEWS`; every variant gets the same `VariantProps`.
- `primitives/board-stage.ts`: one variant's camera, drag, and measurement;
  moved nodes leave the layout and stay where they were dropped.
- `core/lifecycle.ts`: live / fresh / settled / expired / dismissed rules.
- `board.tsx`: production wiring (Home feed, display names and status labels
  for the mapping, avatars, block preview, splits).

## Scope

- Owns: board items (`core/item.ts`), layouts (`core/layout-*.ts` and
  `core/people.ts`, pure and unit-tested), per-viewer memory (positions,
  cameras, closed and seen items), and the five variant views.
- Not here: feed membership and notifications → `useHomeDataSource` in
  `features/home/queries`; entity content → the block `PreviewPanel` mounts.

## Recipes

- Add a variant: id in `core/variants.ts` → a pure layout in `core/` with
  tests → a view in `views/` built on `createBoardStage` → its entry in
  `VARIANT_VIEWS` → names in `views/board-sidebar.tsx` and
  `lib/i18n/locales/en/board.ts`.
- Show a new entity kind: map it in `queries/entity-board-items.ts`; text it
  needs from the app (names, status labels) arrives through
  `BoardItemResolvers`, built in `board.tsx`.

## Checks

- `bun run test src/features/board`
- `bunx playwright test --config src/features/board/browser-test/playwright.config.ts`
  (backend-free fixture; open `/src/features/board/browser-test/index.html`
  on a dev server to look at every variant with sample data).
- `bunx --yes @ast-grep/cli@0.44.1 scan apps/web/src/features/board` from
  the repository root (the feature-layer rules cover this feature).

## Gotchas

- Layout positions animate with `transform`; entrance motion uses the
  individual `scale` property so it composes, and it ends at the node's own
  opacity without holding a value, or settled nodes stop fading
  (`views/board.css`).
- A layout memo must read the stepped clock, not `now()`, or nodes shuffle
  on every tick.
- A modal dialog returns focus to its trigger, and the board's modal has
  none: `BoardView` records what had focus before marking an item seen and
  returns focus there. Lists inside nodes must keep their elements across
  recomputes (`Key`, not `For`, over rebuilt objects) for that to work.
- Gated by `enableCompanyBoard`: off hides the rail item and `g b`, and the
  `/board` route redirects Home.
