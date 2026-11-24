# properties

## What it is

Part of the Databases and CRM features. Entity properties: definitions,
selectable options (including tags), per-entity values, and the CRM
pipeline/stage definitions built on them. Publishes property mutation
events to the `macro.properties` Kafka topic.

## Start here

- `README.md`: the published event catalog (`property.created`,
  `entity_property.updated`, ...) — read before changing anything that writes
  a property or option.
- `src/domain/service_impl.rs` + `src/domain/ports.rs`: the service and the
  writer/notification/permission ports it composes.
- `src/domain/model.rs`: `EntityPropertiesKey`, `PropertyTargetKey`, and the
  CRM team-stage definition constant.
- `src/outbound/properties_pg_repo.rs` +
  `src/outbound/*_queries.rs`: the Postgres adapters, one file per concern
  (definitions, options, entity values, metadata, tag promotion).
- `src/domain/service.rs`: property reads and mutations; Soup does not require a separate definition-reader collaborator.
- `src/outbound/task_dependency_queries.rs`: bounded atomic Depends On / Blocking edits, changed-endpoint authorization, snapshot checks, cycle checks, and canonical reciprocal event receipts.
- Property cleanup captures surviving dependency snapshots under sorted endpoint locks and returns receipts only after commit. New writes cap both endpoints at 1000 references; oversized existing snapshots remain clearable.
- Return and publish primary dependency values from the transaction snapshot; repair canonical JSON even without edge changes. Keep the authored-reference cap in `TASK_DEPENDENCY_REFERENCE_LIMIT`, separate from visibility and batch budgets.
- Use `set_entity_property_with_effects` when a caller needs the write transaction's exact reciprocal task IDs; the ordinary setter preserves its existing response contract.
- `src/domain/task_dependency_state.rs` + `src/outbound/task_dependency_state.rs`: receipt-gated, indexed dependency batches; project per-blocker completion facts with `visible_state` and preserve the full aggregate Blocked flag. The storage completion guard applies the team policy atomically to every Status writer.
- Keep neighbor fanout on the adapter's lazy two-connection pool: clone application connection options, append startup `statement_timeout=10s`, and execute one SELECT without per-acquire pings. Filter document Updated roots by an explicit task subtype; keep deletion/property roots and historical adjacency unfiltered.
- Authorize only added and removed dependency endpoints through bulk document edit receipts; retain inaccessible unchanged references. Lock source, all current endpoints, and all desired endpoints before dependency writes; recheck the snapshot after locking. Use PostgreSQL `task_dependency_lock_key` and sort actual signed keys, not UUIDs.
- Cleanup locks UUID TASK/DOCUMENT roots even without edges or subtype metadata; discover all neighbors, lock them, and validate discovery. Non-document cleanup skips graph locks.
- Treat malformed pre-write neighbor values as absent metadata so cleanup and link repair can finish; keep canonical post-write decoding strict.
- Preserve `PropertiesErr::DependencyContended` for PostgreSQL 40001 and stale snapshots; return HTTP 409 and GraphQL `DEPENDENCY_BUSY` with `retryable: true`.
- Await link transactions through COMMIT; use database statement/lock timeouts instead of an outer Tokio deadline that can discard committed reciprocal receipts.
- Preserve `PropertiesErr::TaskCompletionBlocked` across replacement and option writes; transport adapters map the typed variant, not its display text.

## Scope

- Owns: property definitions/options/values and tag promotion across entity
  types.
- Not here: the generic database engine (tables/columns/cells) → `databases`;
  notification delivery → `notification`.

## Boundaries

- Depends on: `entity_access`, `macro_event_broker`, `model_owner`,
  `notification` (optional, `outbound` feature).
- Used by: `databases`, `ai_tools`, `agent_trigger`, `initiative`, `messages`,
  `search_service`, `soup`, `crm`, `graphql_properties`, `properties_service`,
  `services/document_storage_service`, `services/agent_trigger_service`,
  `services/search_processing_service`.
- Keep Soup sort/group SQL in Soup; property-definition authorization must be designed consistently across filters, grouping, and sorting, not added to one path.

## Recipes

- Add a property event: `src/domain/events.rs` → emit it in
  `src/domain/service_impl.rs` after the write succeeds → document it in
  `README.md`'s event table.
- Add a query: `src/outbound/<concern>_queries.rs` → its sibling `_test.rs`.

## Tool contracts

- AI property/tag adapters omit legacy chat targets; this does not change persisted property entity types.

## Checks

- `cargo test -p properties` (`SQLX_OFFLINE` unset; requires local MacroDB).
- `cargo test -p properties --no-default-features --features outbound` to
  check the outbound-only build other services depend on.

- `ExternalChat` currently has no property-storage mapping.

## Gotchas

- CRM companies and contacts hold values the same way (`CrmCompany` ↔
  `COMPANY`, `CrmContact` ↔ `CONTACT`): receipts come from `entity_access`'s
  CRM rules (current membership, `crm_access`, hidden records for admins and
  owners only) and skip the owner lookup. Stage, Owner and Revenue are
  company-only (`is_property_applicable_to`); custom definitions are team-wide
  and apply to both.
  `inbound/axum_router/test/crm_contact_access.rs` exercises the HTTP routes
  against real CRM access.

- A user or team definition cannot take a built-in property's name.
  `create_property_definition` answers `PropertiesErr::ReservedName` (HTTP 409,
  the body names the property) from the `SystemPropertyKey` names, comparing
  the whole name without regard to case, as the database's
  `check_property_name_not_system` trigger does. The trigger stays as the
  backstop and raises a bare exception, which would surface as a 500. Database
  columns live in their database's own namespace and are not checked.

- Time logged (`SystemPropertyKey::TimeLogged`, `0x16`) is the sum of a task's
  time entries, written only by `crates/time_tracking`. Every value mutator
  calls `reject_derived_property` first and answers a validation error, for
  internal callers too; a new value mutator calls it as well. Deleting all of
  an entity's properties (`delete_entity_properties`) still removes it.

## Related

- Rules: `.agents/rules/rust/architecture.md` · Docs: `README.md`
