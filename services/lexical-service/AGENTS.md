# lexical-service

## What it is

Serves Documents: a Bun server exposing stateless Lexical document
conversions (plaintext, search/cognition preprocessing, markdown, HTML, XML)
over an internal HTTP API, used by search indexing, AI agent context, and
comment/markdown rendering. Production runs on ECS behind the gateway at
`/lexical` (`infra/stacks/lexical-service`, `docker/lexical-service.Dockerfile`).

## Start here

- `src/index.ts`: Hono app wiring every endpoint behind `x-internal-auth-key`
  middleware.
- `src/endpoints/`: one file per route (`plaintext.ts`, `search-text.ts`,
  `cognition-text.ts`/`cognition-v2.ts`, `markdown.ts`, `markdown-snapshot.ts`,
  `html.ts`, `xml.ts`, `comment-mark.ts`, `comment-only-change.ts`,
  `image-markdown.ts`, `agent-context.ts`, `agent-announcement.ts`,
  `extract-reply.ts`, `mentions.ts`).
- `src/lib/`: conversion logic the endpoints call into (`editor.ts`,
  `markdown.ts`, `html.ts`, `comment-only-change.ts`, `comment-mark.ts`,
  `sync-service.ts` client, `schemas.ts`).
- `src/server.ts`: Bun entry; reads env, strips the gateway's `/lexical` prefix.

## Scope

- Owns: pure/stateless transforms of a Lexical document (or markdown) fetched
  from `sync-service`; defines Lexical-editor utilities in
  `packages/lexical-core` first and binds them to a route here.
- Not here: Lexical node/editor primitives themselves → `packages/lexical-core`;
  document persistence and CRDT sync → `sync-service`.

## Recipes

- Add a conversion endpoint: utility in `packages/lexical-core` → `src/lib/`
  wrapper → new file in `src/endpoints/` → register in `src/index.ts`.
- Change the comment-grant gate: `src/lib/comment-only-change.ts` +
  `src/endpoints/comment-only-change.ts` (fails closed; needs
  `LEXICAL_SERVICE_AUTH_KEY` set before deploy).

## Checks

- `bun test test/tests.ts` and the `*.test.ts` files beside their endpoints
  (`bun test`).
- `bun run check` (`tsc --noEmit --project tsconfig.check.json`).
- `bun run plaintext|search|cognition <document-id>` against the local stack's
  `lexical_service` (port 8096) to sanity-check an endpoint end to end.

## Gotchas

- Called only internally, authenticated by `x-internal-auth-key`
  (`INTERNAL_AUTH_KEY`); it also calls `sync-service` with
  `SYNC_SERVICE_AUTH_KEY`. On ECS these come from its Doppler project and
  Secrets Manager; locally from `docker/docker-compose.yml`.
- Run the bundle, not `src/server.ts` directly: unbundled, Bun hits a TDZ in
  the circular `@lexical/*` imports (see the Dockerfile).
- Deploys to dev on every push to `main` and to prod on release. Never deploy
  without explicit permission.

## Related

- Docs: `packages/lexical-core` (shared node/utility source of truth)
