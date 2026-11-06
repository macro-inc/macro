# SDK call rooms

## What it is

This package turns a core SDK call connection into a LiveKit room and provides
screen-share publishing for Node and browsers.

## Start here

- `src/common.ts`: structural contract derived from the core SDK `CallConnection`, connection lifecycle, and one-time leave.
- `src/node.ts`: rtc-node connection and frame-based screen publishing.
- `src/browser.ts`: browser connection and MediaStream screen publishing.

## Scope

- Owns: room connection defaults, screen publication, and cleanup.
- Not here: Macro call authorization and token issuance → `packages/sdk`.

## Boundaries

- Depends on: `@macro-inc/sdk` as a peer, one optional LiveKit runtime peer,
  and `@opentelemetry/api`. Spans are no-ops without a host tracer provider.
- Used by: programs that participate in calls outside the app.

## Checks

- Build the SDK first, then from this directory: `bun install --frozen-lockfile`,
  `bun run check`, `bun test`, `bun run build`, `bun run check:pack`. `SDK Check`
  runs them. `just check` covers format and lint.

## Gotchas

- Versions in lockstep with `@macro-inc/sdk`: never edit the version or peer range
  by hand; run `just bump` in `packages/sdk`. See `../sdk/RELEASING.md`.
- Types come from the SDK's build through `tsconfig.json` `paths`, so build the SDK
  first. The `file:../sdk` dev dependency only satisfies the peer at install, since
  the required version may not be on npm yet.
- Relative imports in `src/` need their `.js` extension: `tsc` keeps specifiers as
  written, and Node's ESM loader won't resolve one without it.
- Never log, attach to spans, or serialize the room token.
- rtc-node has no room-wide publish defaults or publish hook, so the local
  participant's `publishTrack` is wrapped to set `dtx` false for audio.
- Unpublish Node tracks by their publication SID; browser unpublish takes the
  `MediaStreamTrack` itself.
- Frame capture is supplied by the caller; rtc-node has no capture engine.

## Related

- Design: `docs/design/sdk-calls.md`.
