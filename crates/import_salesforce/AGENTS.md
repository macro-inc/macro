# import_salesforce

## What it is

Read-only Salesforce CRM inventory (org, users, active opportunity stages,
accounts, contacts, opportunities). Used by the reviewed workspace importer in
`crates/import`.

## Start here

- `src/domain.rs`: the typed inventory, `SalesforceError` and the
  `SalesforceConnections` read port.
- `src/outbound/client.rs`: `SalesforceRead` and `Query` (the closed set of
  requests and SOQL), paging, the single-currency fallback and the error
  mapping; `client/wire.rs` holds Salesforce's JSON shapes and
  `client/fixtures/` real-shaped answers.

## Boundaries

Reads only, through the user's Pipedream `salesforce_rest_api` connection
(`connectors::ApiConnectionsService`) and the shared paced, retried transport
in `import_tracker::outbound::connection`. Planning, authorization, approval
and writes to Macro belong to `import`; credentials belong to `connectors`.

## Checks

- `cargo test -p import_salesforce`

## Gotchas

- Every URL is a relative `/services/...` path built by `SalesforceRead`:
  Pipedream's proxy fills in the org's instance host. Never build an absolute
  Salesforce URL or follow a `nextRecordsUrl` that is not this API version's
  query locator.
- Paging is complete or an error: a repeated or missing `nextRecordsUrl` on an
  unfinished query fails the read. Records with a malformed id are skipped with
  a warning, never silently.
- Single-currency orgs have no `CurrencyIsoCode`: an `INVALID_FIELD` 400 on the
  opportunity query re-runs it once without the field.
- Errors never carry Salesforce's text, which can name people. The shared
  transport keeps no 403 text, so `API_DISABLED_FOR_ORG` and a 403
  `REQUEST_LIMIT_EXCEEDED` both surface as `Upstream { status: 403 }`.
- Warnings carry record types only, never names, emails or domains.
