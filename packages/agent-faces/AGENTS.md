# Agent faces

## What it is

The cartoon faces of agent teammates. A face is stored as a seed plus pinned
parts (`AgentFace`, in `macro_user_info.avatar_face`), and this package draws
it as an SVG string. It is pure TypeScript: no DOM, no dependencies.

## How it works

`renderFace` turns the seed and pins into a recipe (`src/recipe.ts`: one option
per part, each from its own random stream) and draws the recipe
(`src/draw.ts`) with the shapes in `src/parts.ts`.

## Start here

- `src/index.ts`: the whole public API and the stored type.
- `src/parts.ts`: every option of every part; colours also feed `FACE_PARTS[].swatches`.
- `tests/golden.test.ts`: what must never change.

## Scope

- Owns: the stored `AgentFace` shape, its validation, and the drawing.
- Not here: Solid components, the parts editor, PNG export and upload, or
  where a face is shown → `apps/web/src/features/agent-faces/`.
- Not here: storage and API → `crates/team_agents`, `crates/macro_db_client`.

## Recipes

- Any new option or part changes what existing seeds draw (see Gotchas), so
  it ships as a new version: add `v: 2` to `AgentFace`, branch on it in
  `renderFace` and `parseAgentFace`, keep the version 1 lists untouched, and
  add goldens for both versions.

## Checks

Run from `packages/agent-faces`:

- `bun test`
- `bun run type-check` and `bun run lint` (need `bun install` at the root)

CI runs the type check and the tests in Web App / Typecheck.

## Gotchas

- Saved faces must draw the same forever. A golden failure means the change
  alters them: revert it, or add a version 2 and keep version 1 drawing as is.
- A pin is an option's position in its list, so lists are append-only. Never
  reorder, remove or redraw an option, and never change a weight (`w`), a
  stream name or the order of `next()` calls: each changes existing seeds.
- An option appended to a list still changes what unpinned seeds draw,
  because it joins the weighted pick.
- The goldens came from the playground this was ported from; the output is
  compared byte for byte, including number formatting.
- Keep the SVG free of ids, filters, styles and links. It is used as a data URL
  and may be inlined many times on one page.
