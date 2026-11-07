# frecency

Status: legacy — do not extend; depend on `frecency_core`, `frecency_outbound`
or `frecency_inbound` directly

## What it is

A facade that re-exports the split frecency crates under their old module
paths (`frecency::domain` = `frecency_core`, `frecency::outbound` =
`frecency_outbound`, `frecency::inbound` = `frecency_inbound`), so existing
imports keep working. Any crate that depends on it rebuilds whenever any layer
changes, so new code should name the layer crate it needs.

## Boundaries

- Used by: the composition roots (`document_storage_service`,
  `agent_harness_service`, `email_service`, `connection_gateway`),
  `ai_tools`, and the test builds of `email`, `soup` and `reminders`.

## Checks

- `cargo check -p frecency --all-features`
