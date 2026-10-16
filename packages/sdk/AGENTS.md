# Macro SDK

## What it is

The public TypeScript SDK wraps generated service clients in entity handles.
Authentication and service hosts come from `MacroClient`; permissions remain
enforced by the ordinary backend APIs.

## Start here

- `src/macro.ts`: public exports and namespace registration.
- `src/entities/entity.ts`: lazy detail reads, mutation invalidation and safe JSON.
- `src/entities/workspace/namespace.ts`: filtered activity pages and iteration.
- `services.ts`, `openapi-ts.config.ts`: generated service contract inputs.

## Boundaries

- Keep handwritten behavior in `src/`; never edit `generated/` or `specs/`.
- Use existing entity handles for reads and mutations. Follow the
  [SDK rule](../../.agents/rules/sdk.md) and `add-sdk-endpoint` skill.
- `../sdk-docs/` generates the public TypeDoc reference and static docs Worker.
  Runtime-specific bundles belong to their consumer, not this package.

## Checks

Run from this directory: `bun test`, `bun run check`, `bun run coverage`, and
`bun run lint`. Coverage requires each generated endpoint to be wrapped or
explicitly classified in `src/coverage/skipped.ts`.

## Gotchas

- Regenerate Rust OpenAPI and web service clients before `bun run sync-specs &&
  bun run generate`; do not copy deployed schemas over a local API change.
- Workspace advanced filters use the server's serialized AST names, not Rust
  enum variant names. Validate new filter examples against the real local API.
- Async iterators are lazy; `limit` is page size. Preserve filters on every page
  and do not fetch another page after the caller breaks the loop.
- Handles must serialize identity or loaded detail, never authenticated clients.
- Email sends and other writes against hosted data are real actions; use mocks
  for automated SDK mutation tests.
