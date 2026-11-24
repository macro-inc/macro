# fusion_import

## What it is

Autodesk Fusion imports, driven by the agent's `ImportFromFusion` tool. Each
APS item (a design or file in a Fusion hub) becomes one Macro file document,
and each of its APS versions one version (`DocumentInstance`) of it, oldest
first. A per-user ledger records every APS version seen, so `sync` adds only
new ones. Gated by the `enable-fusion-import` flag.

## How it works

`browse` walks hubs → projects → folders through `ApsReader`. `import` tracks
each item (`fusion_item`, document id chosen up front), then `sync_item` claims
the item's lease, lists its versions, and for each unrecorded one: decides an
outcome, downloads through `signeds3download` + `SignedDownloads`, stores
through `CadDocuments`, records a `fusion_item_version` row. One call
downloads at most 10 versions, starts none after 10 minutes (inside the
15-minute lease), and reports `remaining`; a sync of everything pages 50
items by id with `nextCursor`.

## Start here

- `src/domain/service.rs`: the sync loop and why each call is safe to repeat.
- `src/domain/ports.rs`: every outside dependency.
- `src/outbound/aps.rs`: APS wire types, paging, rate-limit retry.

## Scope

- Owns: the `fusion_item` / `fusion_item_version` ledger, APS reads, the tool.
- Not here: the Autodesk connection (`crates/connectors`, app `autodesk`);
  creating documents and versions (`crates/documents`, `add_file_version`).

## Boundaries

- Depends on: `connectors::ApiConnectionsService` (behind `ApsTransport`),
  `feature_flags`, and a `CadDocuments` adapter over `crates/documents`.
- Used by: `ai_tools` (the toolset) and `agent_harness_service` (wiring).

## Recipes

- Read another APS endpoint: an `ApsReader` method in `domain/ports.rs` →
  `outbound/aps.rs` (wire fields + `Endpoint`) → a test over a fixture.
- Add a version outcome: `VersionOutcome`/`SkipReason` → the migration's
  `outcome` CHECK (new migration) → `import_version` in the service.

## Checks

- `cargo test -p fusion_import` (`SQLX_OFFLINE` unset; the ledger tests need a
  migrated MacroDB).
- Live, with a test account: `APS_ACCESS_TOKEN=<3-legged data:read token>
  cargo test -p fusion_import -- --ignored --nocapture`.

## Gotchas

- `fixtures/` are Autodesk's published examples, not recordings
  (`fixtures/README.md`); replace them once the live test has run.
- Only Macro 3D file types are imported (`cad_file_type`): PDF and image
  documents serve their first version, so later versions would never show.
- A presigned download URL is a credential: never log it (`SignedUrl` redacts
  `Debug`; reqwest errors drop it with `without_url`).
- The ledger has no FK to `"Document"`: the row is written before the
  document exists. A gone document is found with `is_live` and relinked by
  `import`; `sync` reports it as `document_gone`.
- Releasing a lease names the `until` it claimed, so a lapsed holder never
  frees a newer hold.

## Related

- Rules: `.agents/rules/rust/db.md`, `.agents/rules/observability.md`
