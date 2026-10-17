# platform-compat

## What it is

Guards that keep the web app running on the oldest webviews it supports: an
ESLint rule that checks `apps/web/src` against the `browserslist` in
`apps/web/package.json`, and a check that the native bundles keep the camera and
microphone permissions meetings and dictation need.

## How it works

`src/browser-floor-rule.ts` finds references to globals (`SharedWorker`),
their statics (`AbortSignal.any`), members of singleton globals
(`navigator.permissions`), and regex syntax (lookbehind, the `v` flag). It looks
each up in `@mdn/browser-compat-data` and reports any the floor lacks, unless a
feature check guards the use. `src/lint-web.ts` runs it from the repository root.

## Start here

- `src/browser-floor-rule.ts`: what counts as a use and as a guard.
- `src/compat-data.ts`: how a reference maps to a compatibility-data key.

## Scope

- Owns: the browser-floor lint and the native media permission check.
- Not here: the floor itself (`apps/web/package.json` `browserslist`, which
  `apps/web/vite.base.ts` also turns into the esbuild target); signed-DMG
  validation (`tooling/xtask/crates/xtask_workflows/src/workflows/scripts/validate_signed_dmg.sh`).

## Checks

- `bun install --frozen-lockfile && bun run check` (types, tests, native
  permissions, full `apps/web/src` lint; CI runs this in Web App Check).
- `just check` lints changed `apps/web/src` files, or everything when the floor
  or this package changes.

## Gotchas

- This package has its own `bun.lock` and is not a root workspace, so it does
  not change the Nix `node_modules` hash. Install it here, not from the root.
- Only `browser >= version` queries are allowed: the Vite config maps them
  one-to-one to esbuild targets.
- Prototype methods (`array.toSorted()`) need type information and are not
  checked. Neither is partial support such as Chrome for Android's throwing
  `Notification` constructor, because the data marks common APIs like
  `window.open` partial too.
- Silence a guarded use the rule cannot see with
  `// eslint-disable-next-line platform-compat/browser-floor -- <why it is safe>`.
