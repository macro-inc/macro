# Lexical route switching

`LexicalClient` keeps the typed lexical-service API and chooses execution at
startup. Production composition roots read `LEXICAL_ROUTE_MODES` through
`MacroConfig`; env-only bootstrap tools use `LexicalClient::from_env`. Reuse
configured clients (or clones) rather than loading configuration in handlers.
`LexicalClient::new` explicitly constructs an all-HTTP client for isolated use.

The required configuration key is a comma-separated group map. Omitted groups
use HTTP; an empty value also selects HTTP everywhere. Unknown groups, duplicate
assignments, and unknown modes fail startup. The initial provisioning value is:

```text
LEXICAL_ROUTE_MODES=markdown=http,snapshot=http,composers=http,html=http
```

| Group | Operations |
| --- | --- |
| `markdown` | markdown, embedding markdown, search, cognition, cognitionv2, comment marks |
| `snapshot` | markdown/Notion snapshots, mentions, explicit replies |
| `composers` | image markdown, agent context, announcements, connection prompts, chat replies |
| `html` | rendered email HTML and text |

`http` executes only the retained transport. `in_process` executes only the
local adapter, without HTTP fallback. `shadow` executes both, compares their
typed results, and returns the HTTP result, including HTTP errors. Shadow
comparison masks only `"awaitId":"[A-Za-z0-9_-]{21}"` in composer markdown,
as prescribed by S3 §4.4 and §6.5. It never changes the returned response.

The initial facade's local route adapters all return typed `NotYetPorted`.
WP34–38 supply the route-specific fetch, context, and wire integration. Pure
model transformations alone do not provide those adapters. Future CPU-heavy
adapters must use `spawn_blocking` and enter the captured current span.
The sync Worker's comment-only gate has its own `COMMENT_GATE_MODE` and is
outside this client.

Each operation emits `lexical.<route>` under the caller's active span. Shadow
execution emits child `lexical.shadow`; mismatch events include only the stable
route and document id when available. Spans record mode, byte counts, outcome,
and sanitized error kind. POST input and successful output counts use JSON
serialization of the typed request/result; GET input is zero. Neither payloads,
URLs, auth headers, nor backend error text are recorded. The HTTP transport
injects W3C trace headers on every request.

Provision the key in the consuming service Doppler projects' `dev` and `prd`
configs and `local/lcl_personal` before deploying this required-key change.
The local `BootStubEnv` fallback supplies the all-HTTP value for `--no-doppler`.
This work package does not write Doppler or deploy services.
