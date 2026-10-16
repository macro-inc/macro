# Agent code mode

## Scope

Owns session-authorized code executions, SDK documentation selection, saved
execution records, and durable review stacks. Process isolation belongs to
`crates/code_execution`; session presentation belongs to `crates/agent_session`.

## Start here

- `SKILL.md`: the agent-facing JavaScript contract and examples.
- `src/domain/service.rs`: execution admission, identity and persistence.
- `src/domain/reviews.rs`: review validation, revisions, claims and outcomes.
- `src/domain/documentation.rs`: bounded selection of generated SDK docs.

## Boundaries

Inbound adapters authenticate and delegate to domain services. Outbound adapters
implement persistence; the harness composition root wires native actions and
session presentation. Never replay an uncertain submitted action.

## Checks

- `cargo test -p agent_code_mode --lib` from the repository root, with live local
  database configuration and `SQLX_OFFLINE` unset.
- Regenerate SDK documentation through `packages/code-mode-sdk`; never edit
  `src/domain/documentation.json` by hand.
