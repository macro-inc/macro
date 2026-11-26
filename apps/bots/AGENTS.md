# Bots app

## Scope

The standalone Vite entry for the public Character Creator and the Fleet shell.
The public and fixture previews have disabled sign-in and a same-tab, expiring
draft handoff. The optional local auth mode exercises the SDK sign-in flow
with one synthetic reviewer and current team. It cannot create bots.

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

## Local auth review

Build the workspace SDK JavaScript with `bun run --cwd packages/sdk build:js`.
With the isolated Macro Auth service on `127.0.0.1:23011` and its local Mailpit
on `127.0.0.1:23008`, run
`bun run --filter @macro-inc/bots dev:auth` and open the printed
`127.0.0.1` URL. This development-only mode selects an ephemeral port and
accepts requests from that origin. Keep the server on loopback. Open Sign in,
request the synthetic reviewer code, and enter it from Mailpit. The bridge
checks the selected reviewer and free fixture team using Auth's signed identity
and current-team endpoints on each session read. It expires the server-held
session after ten minutes. The browser receives an opaque HttpOnly cookie and a
session status. The default build and the local fixture preview keep sign-in
disabled. The team-agent roster remains rollout-gated.
