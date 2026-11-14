# SDK OCaml proxy

## What it is

The process boundary for permissioned OCaml SDK programs: an HTTP proxy that
matches each request a program makes to one OpenAPI operation, asks a
permission endpoint, and forwards it to the service with the Macro
credential; a mock of that endpoint; a fake upstream for tests. Usage, CLI
flags, upstreams per environment and the wire shapes are in `README.md`; the
contract with its clients is the plan's D1, D3 and D4.

## Start here

- `src/router.ts`: raw target checks and path-template matching; every path-confusion defence is here.
- `src/proxy.ts`: run tokens, the order of checks, forwarding, the call log, the `node:http` server.
- `src/rules.ts`: selector parsing and matching for the permission endpoint.
- `src/operations.ts`: the operation table's schema (D1), including which header names an operation may declare.
- `src/upstreams.ts`: upstream flags and file, the credential header.

## Scope

- Owns: `/v1/executions`, `/api/...`, `/v1/decide`, the fake upstream.
- Not here: the operation table and its permissions → `../spec`; OCaml
  bindings → `../generator`.

## Checks

- `bun run test` and `bun run type-check` in this directory.
- `just check` from the repository root.

## Gotchas

- Not a root workspace member: imports resolve through the root
  `node_modules` (`zod`, `ts-pattern`), so run `bun install --frozen-lockfile`
  at the root first. Never import the TypeScript SDK or sdk-mcp here.
- Serve the proxy with `node:http`, never `Bun.serve`: Bun resolves `..`,
  `%2e%2e` and backslashes in `Request.url` before the handler runs, which
  hides them from the target checks. Tests that need raw targets go through
  `serve()` with a socket.
- Forward the raw matched path, never a re-encoded or URL-normalized one, and
  never anything the router didn't match. A new allowed character in a path
  needs a reason no router or gateway reads it differently.
- Match path first, then method; never fall back to a parameter route because
  the literal route lacks the method (the service wouldn't).
- Forward headers from an allow-list (`content-type`, `accept`, `traceparent`, `tracestate`), the
  matched operation's declared header parameters (`headers` in the table, which refuses
  credential, cookie, routing and hop-by-hop names) and the credential, set last; never pass
  any other program header through.
- The proxy fails closed: anything but an explicit `allow` from the
  permission endpoint is never forwarded.
- Never index a plain object with a caller-chosen name (`__proto__`,
  `constructor`): use `Object.hasOwn`, a `Map`/`Set`, or `Object.create(null)`.
- Only run tokens reach `/api`, and only for their registered operations; the
  execution token only registers runs.
- Never log paths, queries, bodies or results, and never log or return the
  Macro credential; the call log carries operation, decision, outcome, status
  and duration.
- Other processes on the machine probe open ports; tests count only requests
  that carry the credential as forwarded.
