# Lexical route switching

`LexicalClient` keeps the typed lexical-service API and chooses execution at
startup. Production composition roots read `LEXICAL_ROUTE_MODES` through
`MacroConfig`; env-only bootstrap tools use `LexicalClient::from_env(...)?.with_sync_from_env()?`. Reuse
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

Snapshot shadow spans separately record `raw_equal` (unchanged binary bytes)
and `structural_equal`. For these two routes, `equal` means structural
compatibility: golden ancestry and root containers, container kinds/sharing,
content, formatting and authored values all match. Two controlled imports
identify only constructor-generated identity/time fields for the specific input;
identity normalization must be bijective and never rewrites arbitrary payloads.
Notion's returned Markdown stays exact. Empty `MARKDOWN_GOLDEN` remains byte-exact.
This corrects S3's raw-only comparison for independently generated snapshots;
fixture/replayer comparisons are unchanged.

Local adapters call macro_document_model and macro_document_composers, running
CPU work in spawn_blocking under the captured route span. Document exports use
an injected RawDocumentSource, implemented by SyncServiceClient. Composition
roots reuse their existing SyncServiceClient through with_document_source, preserving
their existing credential resolution. Hosts without a sync client call
with_sync_from_env once. Non-HTTP markdown mode then requires the resolved
SYNC_SERVICE_AUTH_KEY value through MacroConfig; it is passed opaquely, never
interpreted as a secret reference. Secret resolution belongs to the host. SyncServiceUrl provides the typed URL and its
local OVERRIDE_SYNC_SERVICE_URL override. No credentials are loaded in handlers.
HTTP-only configuration does not require this extra source.

The unused legacy cognition methods remain explicit NotYetPorted local operations;
removing their API and the service is deferred to WP39. The Worker's gate is
selected separately with COMMENT_GATE_MODE=http|in_process|shadow; HTTP is its
checked-in default in every environment.

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
