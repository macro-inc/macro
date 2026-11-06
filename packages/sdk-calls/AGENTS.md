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

- `bun test` and `bun run check` from this directory; `just check` covers format and lint.

## Gotchas

- Never log, attach to spans, or serialize the room token.
- rtc-node has no room-wide publish defaults or publish hook, so the local
  participant's `publishTrack` is wrapped to set `dtx` false for audio.
- Unpublish Node tracks by their publication SID; browser unpublish takes the
  `MediaStreamTrack` itself.
- Frame capture is supplied by the caller; rtc-node has no capture engine.

## Related

- Design: `docs/design/sdk-calls.md`.
