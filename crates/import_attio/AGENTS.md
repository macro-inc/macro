# import_attio

## What it is

Read-only Attio CRM inventory (workspace, members, deal stages, companies,
people, deals, custom attribute slugs), read through the user's Attio MCP
connection. Used by the reviewed workspace importer in `crates/import`.

## Start here

- `src/domain.rs`: the typed inventory, `AttioError` and the
  `AttioConnections` read port.
- `src/outbound/client.rs`: `AttioRead` (the closed set of tool calls),
  paging, pacing, rate-limit retries and the error mapping.
- `src/outbound/client/wire.rs`: every Attio answer shape and its decoding.

## Boundaries

Reads only, through `connectors::McpConnectionsService::call_tool` on the
user's `attio` handle (overlaid at `https://mcp.attio.com/mcp`; a native
source has no API surface, so the HubSpot-style API path is closed). Pacing
reuses `import_tracker::outbound::connection::RequestPacer`. Planning,
authorization, approval and writes to Macro belong to `import`.

## Checks

- `cargo test -p import_attio`
- `cargo clippy -p import_attio --all-features --tests`

## Gotchas

- The tool set is closed: names and arguments come only from `AttioRead`,
  never from callers. Argument names (`object`, `limit`, `offset`) are
  ASSUMED, mirroring Attio REST.
- Every answer shape is ASSUMED until a real capture (`tools/list` plus one
  `list-records` per object on a synthetic free-plan workspace). Keep shape
  knowledge in `wire.rs`, the `ASSUMED_*` fixtures and the stand-in's
  `standin/workspace.json` only, and change them together; prose or an
  unknown shape fails as `Decode`, and errors never quote the answer.
- Never default a field the importer reads (`#[serde(default)]`, an
  `Option` for a required key): a renamed field must fail loudly, not import
  empty records. Records need `values`, a page must carry each attribute its
  object is read from (`wire::needed`), objects need `api_slug`, and the
  deals `stage` needs inline `options` with both flags.
- `AttioError::Tool`'s `Display` omits Attio's text, which spans record;
  `ToolNotListed` is `MissingTool`, a gone connection `NotConnected`.
- The importer is off behind `enable-attio-import` in `crates/import` and
  the web until the capture lands.
- Paging is complete or an error: it runs until an empty page (a short page
  may be a server cap), and a page repeating a record already read fails.
- A rate limit is ASSUMED to show as an `is_error` result mentioning 429 or
  a rate limit; retries are bounded and end in `Unavailable`.
- Deals are off by default in Attio: no active `deals` object warns and
  still imports companies and people, with no deals calls.
- Warnings and span fields carry ids, slugs and counts only, never names,
  emails, domains, arguments or results.
- `standin::AttioStandin` (feature `standin`, binary `attio_mcp_standin`) is
  labelled "Attio MCP stand-in (synthetic records, ASSUMED output shape) —
  not Attio" everywhere it shows. It proves the importer against the
  assumption, not against Attio; keep its data synthetic.

## Related

- Rules: `.agents/rules/observability.md` · Crates: `crates/import_hubspot`
