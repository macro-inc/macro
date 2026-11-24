# import_hubspot

## What it is

Read-only HubSpot CRM inventory (portal, owners, deal pipelines, companies,
contacts, deals, custom property names). Used by the reviewed workspace
importer in `crates/import`.

## Start here

- `src/domain.rs`: the typed inventory, `HubspotError` and the
  `HubspotConnections` read port.
- `src/outbound/client.rs`: `HubspotRead` (the closed set of requests),
  paging, company links and the error mapping; `client/wire.rs` holds
  HubSpot's JSON shapes and `client/fixtures/` real-shaped answers.

## Boundaries

Reads only, through the user's `hubspot` connection
(`connectors::ApiConnectionsService`) and the shared paced, retried transport
in `import_tracker::outbound::connection`. Planning, authorization, approval
and writes to Macro belong to `import`; credentials belong to `connectors`.

## Checks

- `cargo test -p import_hubspot`

## Gotchas

- Never accept request paths from callers; every URL comes from `HubspotRead`
  on `api.hubapi.com`. Inventory never writes to HubSpot.
- List endpoints only, never the search API: search caps at 10,000 results
  and 4 requests per second.
- Paging is complete or an error: a repeated `after` cursor fails the read.
  Unreadable records are skipped with a warning, never silently.
- A 403 names the scope the read needs (`HubspotRead::scope`); a 401 means
  the grant must be reconnected. Property schemas are optional: a refusal
  there only warns.
- Primary company links: v3 inline type `contact_to_company`/`deal_to_company`
  (the `_unlabeled` types are not primary); v4 HubSpot-defined type ids 1 and 5.
- Warnings carry record ids only, never names, emails or domains.
