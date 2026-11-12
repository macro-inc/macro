# contacts

Status: legacy — do not extend; depend on `contacts_core`, `contacts_inbound`
or `contacts_outbound` directly

## What it is

A facade that re-exports the split contacts crates under their old module
paths (`contacts::domain` = `contacts_core`, `contacts::inbound` =
`contacts_inbound`, `contacts::outbound` = `contacts_outbound`), so existing
imports keep working. A crate that depends on it rebuilds whenever any layer
changes, so new code should name the layer crate it needs.

## Boundaries

- Used by: the composition roots (`contacts_service`,
  `document_storage_service`, `authentication_service`, `email_service`,
  `agent_harness_service`) and `agent_tools`.

## Checks

- `cargo check -p contacts --all-features`
