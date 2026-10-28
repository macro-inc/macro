# Board

## What it is

The Board rail view: Home's Signal feed drawn as a pannable, zoomable map of
what is happening, with several layout variants (V1A–V1E) to compare. Items
open in a modal over the board; read items settle, fade, and leave.

## Start here

- `views/board-view.tsx`: variant picker sidebar, top bar, modal, and the
  variant switch; every variant gets the same `VariantProps`.
- `primitives/board-stage.ts`: one variant's camera, drag, and measurement;
  moved nodes leave the layout and stay where they were dropped.
- `core/lifecycle.ts`: live / fresh / settled / expired / dismissed rules.
- `board.tsx`: production wiring (Home feed, avatars, block preview, splits).

## Scope

- Owns: board items (`core/item.ts`), layouts (`core/layout-*.ts`, pure and
  unit-tested), per-viewer memory (positions, cameras, closed and seen items),
  and the five variant views.
- Not here: feed membership and notifications → `features/home/queries`;
  entity content → the block `PreviewPanel` mounts.

## Recipes

- Add a variant: id in `core/variants.ts` → a pure layout in `core/` with
  tests → a view in `views/` built on `createBoardStage` → names in
  `views/board-sidebar.tsx` and `lib/i18n/locales/en/board.ts`.
- Show a new entity kind: map it in `queries/entity-board-items.ts`.

## Checks

- `bunx vitest run src/features/board`
- `bunx playwright test --config src/features/board/browser-test/playwright.config.ts`
  (backend-free fixture; open `/src/features/board/browser-test/index.html`
  on a dev server to look at every variant with sample data).

## Gotchas

- Layout positions animate with `transform`; entrance motion uses the
  individual `scale` property so it composes (`views/board.css`).
- A layout memo must read the stepped clock, not `now()`, or nodes shuffle
  on every tick.
- Gated by `enableCompanyBoard`; off keeps the rail, route and `g b` absent.
