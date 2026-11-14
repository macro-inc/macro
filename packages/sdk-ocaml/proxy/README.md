# SDK HTTP proxy and mock permission endpoint

Small Bun servers that sit between a compiled OCaml SDK program and Macro's
services (contracts D3 and D4 in the plan). The permission unit is the
OpenAPI operation, named `<service>.<operationId>` (`storage.edit_document`),
as listed in the operation table `packages/sdk-ocaml/spec/operations.json`
(contract D1).

- **Proxy** (`src/proxy.ts`): the only way a program reaches Macro. A program
  sends plain HTTP to `/api/<service><path>`; the proxy matches it to one
  operation, refuses it unless the operation is in the run's analyzed set and
  the permission endpoint allows it, and forwards it to the service with the
  Macro credential, which lives only in the proxy's environment.
- **Permission endpoint** (`src/permissions.ts`): `POST /v1/decide` answers
  `allow` or `block` per operation, from a rules file and the operation
  table. A mock of the real per-user setting.
- **Fake upstream** (`src/fake-upstream.ts`): a stand-in service for tests
  and the end-to-end script that records requests exactly as they arrive.

Run everything with Bun 1.3 (`nix shell nixpkgs#bun` on NixOS), after
`bun install --frozen-lockfile` at the repository root. Nothing here uses the
TypeScript SDK or sdk-mcp.

## Permission endpoint

```sh
bun run packages/sdk-ocaml/proxy/src/permissions.ts \
  --rules packages/sdk-ocaml/proxy/fixtures/rules.json \
  --operations packages/sdk-ocaml/spec/operations.json \
  --port 8788            # --hostname defaults to 127.0.0.1
```

`fixtures/operations.json` is a small hand-written table in D1 format for
tests and demos. The installed copy beside the OCaml SDK (D1 entries plus
`ocaml`) works too; extra keys are ignored.

Rules file:

```json
{
  "default": "block",
  "rules": [
    { "match": "@read", "decision": "allow" },
    { "match": "documents@update", "decision": "allow" },
    { "match": "email.*", "decision": "allow" },
    { "match": "@destroy", "decision": "block" },
    { "match": "email.send_message", "decision": "block" }
  ]
}
```

| Selector | Matches |
| --- | --- |
| `storage.edit_document` | that operation |
| `documents.*` | every operation in group `documents`, any action |
| `@destroy` | every operation with action `destroy` (`create`, `read`, `update`, `destroy`, `send`) |
| `documents@update` | operations in group `documents` with action `update` |

The last matching rule wins; no match gets `default`. An operation missing
from the table is always `block`, inherited names such as `__proto__`
included. A selector naming an unknown operation, group or action fails
startup, so a typo can't fall through to the default; so does a table with a
duplicate name.

```sh
curl -s http://127.0.0.1:8788/v1/decide \
  -d '{"methods": ["storage.edit_document", "storage.delete_document", "x.y"]}'
# {"decisions":{"storage.edit_document":"allow","storage.delete_document":"block","x.y":"block"}}
```

## Proxy

```sh
MACRO_SDK_EXECUTION_TOKEN=<execution token> MACRO_API_KEY=<credential> \
bun run packages/sdk-ocaml/proxy/src/proxy.ts \
  --operations packages/sdk-ocaml/spec/operations.json \
  --permissions-url http://127.0.0.1:8788 \
  --upstream storage=http://127.0.0.1:8086 \
  --upstream email=http://127.0.0.1:8087 \
  --port 8787            # --hostname defaults to 127.0.0.1
```

| Option | Env fallback | Meaning |
| --- | --- | --- |
| `--operations <file>` | | the operation table (D1) |
| `--upstream <service>=<base url>` | | a service's base URL; repeatable |
| `--upstreams <file>` | | the same as JSON, `{"<service>": "<base url>"}`; combines with the flags |
| `--permissions-url` | `MACRO_SDK_PERMISSIONS_URL` | base URL of the permission endpoint |
| `--token` | `MACRO_SDK_EXECUTION_TOKEN` | the execution token, for registering runs; prefer the env var (argv shows in `ps`) |
| `--upstream-timeout-ms` | | how long to wait for a service (default 60000) |
| `--port` | | port to listen on (default 8787); `0` picks a free one, and the `proxy.listening` log line carries the bound `url` |
| | `MACRO_API_KEY` | the Macro credential added to every forwarded request; required |

The credential header follows the TypeScript SDK's choice
(`packages/sdk/src/utils/client.ts`): a `mak_…` API key is sent as
`x-macro-user-api-key`, anything else as `authorization: Bearer …`. A bot
token (`mbot_…`) fails startup. Never pass `MACRO_API_KEY` to the program.

A service named in `--upstream` that the table doesn't have, or named twice,
fails startup. A service with no upstream is still matched and checked, then
answers `502 upstream_unavailable`.

### Upstreams per environment

A service's base URL is where its OpenAPI paths are served: the forwarded URL
is the base URL followed by the operation's path. These are the same base
URLs the TypeScript SDK uses (`HOSTS` in `packages/sdk/src/config.ts`; for
the local stack, `portmap.json` overrides them). `search` and `properties`
are served by the storage service, so they share its base URL. Keep these in
a file per environment rather than in code:

| Service | Hosted (prod; dev uses `dev-gateway.macro.com`) | Local stack (default ports) |
| --- | --- | --- |
| `agent-harness` | `https://gateway.macro.com/agent-harness` | `http://localhost:8101` |
| `auth` | `https://gateway.macro.com/auth` | `http://localhost:8080` |
| `calendar` | `https://gateway.macro.com/calendar` | `http://localhost:8088/calendar` |
| `cognition` | `https://gateway.macro.com/cognition` | `http://localhost:8101/cognition` |
| `connection` | `https://gateway.macro.com/connection-gateway` | `http://localhost:8082` |
| `contacts` | `https://gateway.macro.com/contacts` | `http://localhost:8083` |
| `email` | `https://gateway.macro.com/email` | `http://localhost:8087` |
| `notification` | `https://gateway.macro.com/notification` | `http://localhost:8089` |
| `properties` | `https://gateway.macro.com/dss` | `http://localhost:8086` |
| `scheduled-action` | `https://gateway.macro.com/scheduled-action` | `http://localhost:8101/scheduled-action` |
| `search` | `https://gateway.macro.com/dss` | `http://localhost:8086` |
| `static-files` | `https://static-file-service.macro.com` | `http://localhost:8100` |
| `storage` | `https://gateway.macro.com/dss` | `http://localhost:8086` |
| `unfurl` | `https://gateway.macro.com/unfurl` | `http://localhost:8095` |

```json
{ "storage": "http://localhost:8086", "search": "http://localhost:8086", "properties": "http://localhost:8086" }
```

### Runs: `POST /v1/executions`

Whoever starts a program registers the operations it may call,
authenticated with the execution token, and gets a fresh random run token (stored only as a hash).
The program gets only the run token (`MACRO_SDK_RUN_TOKEN`). `/api` accepts
only run tokens: the execution token answers 401, so a program cannot skip
registration, and a run token cannot register another run. A name the table
doesn't have is refused (400): the registering side and the proxy must read
the same table. Runs live in memory until the proxy stops.

```sh
curl -s http://127.0.0.1:8787/v1/executions \
  -H "authorization: Bearer $MACRO_SDK_EXECUTION_TOKEN" \
  -d '{"operations": ["storage.get_document", "storage.delete_document"]}'
# 200 {"token":"<run token>"}
```

### Calls: `ANY /api/<service><path>?<query>`

```sh
curl -si http://127.0.0.1:8787/api/storage/documents/d1 \
  -H "authorization: Bearer $RUN_TOKEN"
# whatever the storage service answered to GET /documents/d1, status and body unchanged

curl -si -X DELETE http://127.0.0.1:8787/api/storage/documents/d1 \
  -H "authorization: Bearer $RUN_TOKEN"
# 403, x-macro-proxy: refused
# {"error":{"code":"blocked","message":"storage.delete_document is blocked by the permission policy"}}

curl -si -X POST http://127.0.0.1:8787/api/storage/documents/d1/edit \
  -H "authorization: Bearer $RUN_TOKEN" -H 'content-type: application/json' -d '{}'
# 403, x-macro-proxy: refused
# {"error":{"code":"not_analyzed","message":"storage.edit_document is not among the operations analyzed for this run"}}

curl -si http://127.0.0.1:8787/api/storage/nothing/here -H "authorization: Bearer $RUN_TOKEN"
# 404, x-macro-proxy: refused  {"error":{"code":"unknown_operation",...}}

curl -si http://127.0.0.1:8787/api/storage/documents/d1 -H "authorization: Bearer $MACRO_SDK_EXECUTION_TOKEN"
# 401, x-macro-proxy: refused  {"error":{"code":"unauthorized","message":"missing or unknown run token"}}
```

The order of checks:

1. Run token (401 `unauthorized`).
2. Request shape (400 `invalid`): a method override header
   (`x-http-method-override`, `x-http-method`, `x-method-override`) or a body
   on GET.
3. Target and route: the raw request target is checked (400
   `invalid_target`), then `(service, method, path)` is matched against the
   table's path templates (404 `unknown_operation`). Never forwarded.
4. The run's analyzed set (403 `not_analyzed`); the permission endpoint is not
   asked.
5. The permission endpoint, on every call (403 `blocked`; 502
   `permission_unavailable` when it is unreachable or its reply is anything but
   an explicit `allow` or `block` under the operation's own key).
6. Forward, and return the service's status, `content-type` and body
   unchanged; any other status the service picks (its own 403 or 404
   included) comes back without `x-macro-proxy`.

Every response the proxy produces itself carries `x-macro-proxy: refused`,
so a client can tell a proxy 403 from a service 403.

| Status | `error.code` | When |
| --- | --- | --- |
| 400 | `invalid` | method override header, body on GET, malformed `/v1/executions` body or unknown operation in it |
| 400 | `invalid_target` | the request target fails the checks below |
| 401 | `unauthorized` | `/api`: missing or unknown run token (the execution token included); `/v1/executions`: missing or wrong execution token |
| 403 | `not_analyzed` | the operation is not in the run's analyzed set |
| 403 | `blocked` | the permission endpoint said block |
| 404 | `unknown_operation` | no operation of the service matches the method and path |
| 404 | `not_found` | not `/v1/executions` or `/api/...` (absolute-form targets included) |
| 405 | `invalid` | `/v1/executions` with a method other than POST |
| 413 | `payload_too_large` | body over 32 MiB |
| 502 | `permission_unavailable` | the permission check failed; fails closed |
| 502 | `upstream_unavailable` | no upstream for the service, or it didn't answer |

### Matching

The service's own router decides which handler runs, so the proxy matches the
way it does and refuses anything a router, gateway or URL parser on the way
might read differently. The target is read raw (the server uses `node:http`,
because `Bun.serve` resolves dot segments before the handler sees them).

- The target is origin-form starting with `/api/`. The Host header plays no
  part and is never forwarded.
- Refused: empty segments (`//`, a trailing `/`), dot segments (`.`, `..`),
  `;`, `#`, and any character outside RFC 3986's `pchar` (backslash, space,
  raw non-ASCII, `{`, `"`, ...).
- Percent-encoding is decoded once for matching. Refused: malformed triplets,
  invalid UTF-8, and encoded `/`, `\`, `%`, control characters and unreserved
  characters (`%73earch` would be `search` here but a parameter value to a
  router matching raw literals).
- Literal segments and service names are case-sensitive. A literal beats a
  parameter at each segment, backtracking only when the literal branch has no
  route; the method is checked after the path, so `DELETE /documents/search`
  is unknown even though `DELETE /documents/{document_id}` exists.
- Services sharing an upstream origin are matched together on the full
  upstream path, so a request under one service can't win a route of another
  on the same host.
- The query is forwarded byte for byte and plays no part in matching; a raw
  `'` in it is refused (fetch would rewrite it to `%27`).

What is forwarded: the method, the base URL plus the raw matched path, the raw
query, the body, `content-type`, `accept`, `traceparent`, `tracestate`, the
header parameters the matched operation declares (its `headers` in the
table, e.g. `x-macro-passwords` for the storage password operations) and the
credential (`traceparent` also goes to the permission endpoint). The proxy
opens no spans of its own yet. Nothing else: no `authorization` from the
program, cookies, `host`, `x-forwarded-*`, hop-by-hop headers, or any header
the matched operation doesn't declare. The table can't declare those: a
table whose `headers` names a credential, cookie, routing, framing or
hop-by-hop header (or isn't lowercase) fails to load, and the credential is
set last, so no declared header replaces it. Redirects are never followed.

Each `/api` request logs one JSON line on stdout, never the path, query, body
or any credential:

```json
{"event":"sdk_call","run":"3f9a0c1b2d4e","method":"POST","operation":"storage.edit_document","decision":"allow","outcome":"forwarded","status":200,"durationMs":12}
```

## Fake upstream

```sh
bun run packages/sdk-ocaml/proxy/src/fake-upstream.ts --responses responses.json --port 8789
```

All three servers take `--port 0` to listen on a free port, and log a
`{"event": "<name>.listening", "url": ...}` line with the URL they bound;
a script can read the ports from those lines.

`responses.json` maps `"<METHOD> <raw target>"` (base path and query
included) to `{"status", "contentType"?, "body"}`; anything else answers 404.
It logs each request's method and target.

## Tests

```sh
cd packages/sdk-ocaml/proxy
bun run test         # bun test
bun run type-check   # tsc; needs node, or: bun ../../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```
