# Theme color inventory

Every `--color-*` token the web app defines. Source of truth for names is
`themeColorInventory.ts`; this file is the human-readable map. A test fails
if `@theme` in `index.css` grows or drops a name that is not listed there.

**149 tokens** in CSS. **52** of those are in the V3 theme registry
(25 input + 27 semantic). The other **97** are CSS-only.

A V3 theme stores raw input colors and optional semantic overrides. CSS
then derives the rest. Assignments that stay as `var(--color-…)` or
`color-mix(…, var(--color-…), …)` **do cascade** when an input changes.
A literal `oklch(…)` override does not.

`--theme-surface`, `--theme-inset`, and `--theme-panel` are the only
theme-owned aliases that can replace a public `--color-*` without writing
the public var directly. There is no `--theme-chrome`.

## 1. Input tokens (25) — required, authored

These are the only raw colors `isThemeV3` requires. They are visible in
the theme editor under Surface / Content / Edge / Accent / Palette.
`content-*` has no Tailwind class; UI uses `text-ink`, `text-ink-muted`,
and the rest of the ink ramp.

| Token | Default in `@theme` | Notes |
| --- | --- | --- |
| `surface-0` … `surface-4` | `--b0` … `--b4` | Depth ramp. Layer CSS remaps `surface` / `inset` across depths 0–4. |
| `content-0` … `content-4` | `--c0` … `--c4` | Ink ramp source. Not a Tailwind color. |
| `edge` | `surface-4` | |
| `edge-muted` | `surface-3` | Heaviest border class (`border-edge-muted`). |
| `accent` | `--a0` | |
| `red` `orange` `amber` `yellow` `lime` `green` `teal` `cyan` `blue` `violet` `purple` `pink` | Tailwind-500 OKLCH | Legacy conversion keeps accent L/C and swaps the hue angle. |

## 2. Semantic tokens (27) — V3 registry, editor-overridable

`getDefaultSemanticColorTokens()` fills any of these a theme omits.
Advanced mode currently exposes **all** input + semantic tokens, not
semantics alone.

| Token | Default assignment | Tailwind use (approx.) |
| --- | --- | --- |
| `surface` | `--theme-surface` or `--layer-surface` | `bg-surface` (~580). Layer-relative. |
| `inset` | `--theme-inset` or `--layer-inset` | Inset tabs / wells. A fixed value looks wrong on a modal vs a panel because the layer inset changes with depth. |
| `ink` | `content-0` | `text-ink` |
| `ink-muted` | `content-1` | `text-ink-muted` (heaviest ink class) |
| `ink-subtle` | `content-2` | |
| `ink-disabled` | `content-3` | |
| `ink-placeholder` | `content-4` | |
| `link` `link-hover` `link-visited` | `accent` | |
| `page` | `surface-0` | Almost unused as a class. |
| `panel` | `--theme-panel` or `surface-1` | Inactive split chrome darkens this locally. |
| `dialog` `menu` `tooltip` `toast` | `surface-2` | Menu is the popup surface; tooltip/toast almost unused as classes. |
| `input` | `transparent` | Macro Dark points this at `control` (a CSS-only token). |
| `input-focus` | `surface-1` | |
| `message` | `surface-1` | |
| `inline-code` | `ink` @ 5% | In the registry and CSS; default theme files omit it so the central default wins. |
| `hover` | `content-0` @ 3% | |
| `active` | `content-0` @ 6% | |
| `selected` | `accent` @ 8% | |
| `success` | `green` | |
| `warning` | `amber` (dark) / `yellow` (light) | `@theme` always uses `amber`. Light built-ins override to `yellow`. |
| `failure` | `red` | |
| `chrome` | **mismatch** — see below | Mobile island / glass chrome. |

### `chrome` default mismatch

- V3 default (`getDefaultSemanticColorTokens`): `var(--color-surface-4)`
- `@theme` CSS: `color-mix(in oklch, var(--color-surface-3) 98%, var(--color-content-0))`
- Built-in themes all author `chrome` themselves (Macro Dark uses a literal
  `oklch(0.2 0.002 250deg)` so it does **not** follow the page base)

There is no `--theme-chrome` fallback. A caller that wants
`color-mix(in oklch, var(--color-menu) 85%, var(--color-active))` has to
write that onto `chrome` itself.

## 3. CSS-only semantics (26) — not in the V3 editor

| Token | Default | Why it exists |
| --- | --- | --- |
| `accent-contrast` | ink-on-accent from `--accent-contrast-l` | Invert remaps this to the captured surface. |
| `accent-contrast-muted` | contrast @ 70% | Almost unused. |
| `control` | `surface-2` | Macro Dark `input` / `input-focus` point here. |
| `edge-frame` | `content-0` @ 8% | |
| `edge-button` | `content-0` @ 5% | |
| `edge-divider` | `content-0` @ 4% | |
| `edge-focus` | `content-0` @ 40% | |
| `menu-glass` | `menu` @ 88% on touch; solid `menu` on desktop | |
| `composer` | `surface-2`; light mode remaps to `surface-4` | |
| `composer-ink` | `ink` | |
| `composer-placeholder` | `ink-placeholder` | |
| `composer-action` | `ink` | |
| `composer-action-ink` | `panel` | |
| `code-buffer` | `surface-0` 60% / `surface-1` in sRGB | |
| `thread-rail` | `surface` mixed with `ink` (90% light / 70% dark) | Must stay opaque. |
| `modal-overlay` | `oklch(0 0 0 / 0.25)` | Literal, not theme-relative. |
| `drop-shadow` | `oklch(0.15 0 0 / 0.04)` | Literal. |
| `avatar-edge` | black 40% dark / white 40% light | Comment says intended production alpha is 0.08. |
| `skeleton` | `ink` @ 10% | |
| `list-hover` | `hover` | |
| `list-highlighted` | `active` in `@theme`; `hover` inside invert | |
| `list-selected` | `selected` | |
| `list-selected-highlighted` | `accent` @ 16% | |
| `ink-extra-muted` | `ink-subtle` | Compatibility alias. Still the second-heaviest ink class (~595). |
| `button` | `surface` | Compatibility; no Tailwind hits. |
| `overlay` | `modal-overlay` | Compatibility. |

## 4. Generated variants (51)

For `accent` and each palette / status hue: `{name}-bg` (15% wash, accent
is 8%), `{name}-ink` (the hue itself), `{name}-hover` (20% wash). Plus
`alert` / `alert-bg` / `alert-ink` as copies of `warning`.

Most palette `*-bg` / `*-ink` / `*-hover` tokens have **no** Tailwind
class usage. Status variants (`failure-bg`, `success-ink`, `alert-ink`)
are the ones that are actually used.

## 5. Entity / icon aliases (20)

| Token | Alias of |
| --- | --- |
| `comment` `calendar` `contact` `image` | `yellow` |
| `canvas` | `amber` |
| `folder` `write` `rss` | `blue` |
| `video` `note` | `violet` |
| `code` | `lime` |
| `chat` | `cyan` |
| `html` | `orange` |
| `task` | `green` |
| `snippet` | `pink` |
| `pdf` | `red` |
| `default` | `content-1` |
| `email` | `default` |
| `comment-bg` | `comment` @ 15% |
| `comment-ink` | `comment` (invert) / `oklch(from var(--color-comment) var(--c1l) c h)` in `@theme` — marked scuffed |

Monochrome-icon mode overwrites several of these on `documentElement`.

## 6. Used but not defined

`--color-*: initial` disables the default Tailwind palette, so these
resolve to nothing:

- `--color-gray-100` — canvas empty-state hatch
- `--color-transparent` — PDF pinned-terms border

Retired V3 keys that `normalizeThemeColorTokens` still strips: `surface-5`,
`edge-subtle`, `lift`.

## Layer / invert / mode behavior

- `[data-layer][data-depth=N]` points `--layer-surface` at `surface-N` and
  `--layer-inset` at `surface-(N-1)` (depth 0 insets to `surface-0`).
- `[data-invert]` rebuilds the surface and content ramps from captured ink
  / page, then rebinds the public semantics. It does **not** rebind
  `chrome` or the composer tokens.
- Light mode additionally remaps `composer` → `surface-4` and
  `avatar-edge` → white.
- Desktop (not-touch) forces `menu-glass` to opaque `menu`.

## Editing model (as of this inventory)

1. Simple / chip editing writes input tokens.
2. Advanced mode shows every input + semantic token, with link / mix /
   alpha controls.
3. CSS-only tokens are not editable. Changing `menu` cascades to
   `menu-glass`; changing `content-0` cascades to any semantic still
   stored as `var(--color-content-0)` or a `color-mix` of it.
4. Built-in themes persist the full semantic graph (except `inline-code`)
   as `var()` links, so they stay tied to inputs after the initial write.
   A user who picks a literal color on a semantic **breaks** that tie.
