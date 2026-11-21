# website-v2

## What it is

A from-scratch proposal for the public Macro website: one static page with no
build step and no packages. Fonts load from Google Fonts. It is not deployed;
the live site is `apps/marketing`.

## Start here

- `index.html`: all content, in page order. Each product Block is an
  `<article data-block>`; the tab list is built from those at load.
- `styles.css`: tokens, base styles, header, hero and walkthrough. Every color
  and font is a token in the first `:root` block; dark values are repeated in
  the media query and the `[data-theme]` block.
- `sections.css`: the sections below the hero, then the narrow-screen rules
  for the whole page. It loads second so those rules win.
- `site.js`: progressive enhancement only (walkthrough steps, Block tabs, copy
  button, keycaps). The page reads in full with scripts off.

## Scope

- Owns: the proposal page and its assets.
- Not here: the deployed website, docs rendering, legal pages, SEO redirects →
  `apps/marketing`. Customer docs content → `apps/docs`.

## Recipes

- Preview: `python3 -m http.server 4173` in this directory, then open
  `http://localhost:4173/`.
- Add a Block: add an
  `<article class="block" id="name" data-block="Name" data-icon="i-…">` to
  `.blocks-list` and a WebP screenshot under `assets/blocks/` (1800px wide,
  16:9). The tab and its `#name` link come from the `id`.
- Add an icon: add a `<symbol>` to the sprite at the top of `index.html`
  (16×16, stroke only).

## Checks

- Load the page at 1440px and 390px in light and dark: no horizontal scroll, no
  console errors.
- Turn scripts off: every Block and all four walkthrough steps stay visible.

## Gotchas

- Every factual claim (prices, plan limits, certifications, shortcuts, import
  behavior) comes from the root `README.md`, `apps/docs`,
  `apps/web/src/features/paywall/plans.ts`, or the pricing copy in
  `apps/marketing` (the per-seat monthly unit). Change the page when those
  change, and add no claim without a source there. Where two sources disagree,
  leave the claim out.
- Screenshots are copies of `.github/readme/framed/*.png`. Keep the two in
  step, and use demo content only.
- The product mock in the hero is always dark (`--app-*` tokens). Do not tie
  it to the page theme.
- People and companies in the mock are fictional. Use no real names or email
  addresses.
- Do not import from `apps/marketing`, and do not add a `package.json`: a new
  workspace member changes `bun.lock`.

## Related

- Docs: `apps/marketing/README.md` (the deployed site), `apps/docs/AGENTS.md`
  (product terminology)
