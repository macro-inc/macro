# Bots app

## Scope

The standalone Vite entry for the public Character Creator and the Fleet shell.
The auth seam uses checked-in SDK auth response types. Its current adapter is
offline and exposes a disabled sign-in flow with a same-tab, expiring draft
handoff. It cannot create bots.

## Start here

- `src/main.tsx` registers routes and renders the shell.
- `src/return-intent.ts`, `src/draft.ts`, and `src/session.ts` own the handoff.
- `scripts/verify-bots-boundary.ts` and `scripts/botsBoundary.ts` enforce isolation.
  Keep imports inside this app or an explicitly allowed workspace package.

## Checks

Run these commands from the workspace root.

```sh
bun run --filter @macro-inc/bots check:boundary
bun run --filter @macro-inc/bots type-check
bun run --filter @macro-inc/bots lint
bun run --filter @macro-inc/bots test
bun run --filter @macro-inc/bots build
```

`bun run --filter @macro-inc/bots dev` serves the local fixtures on loopback
port 23030 with strict port checking. Check availability before starting it.
For a compiled fixture preview, run `bun run --filter @macro-inc/bots build:preview`
then `bun run --filter @macro-inc/bots preview`. That preview serves only
`dist-local`. Set `BOTS_PREVIEW_HOST` to a single exact hostname when an
authorized local reverse proxy needs a forwarded Host header.

The default build writes `dist` and excludes the Fleet sample data. Keep
`dev.bots.macro.com` and `bots.macro.com` as planning targets until the relevant
auth, infrastructure, and release changes are approved.
