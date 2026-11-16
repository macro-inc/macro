# agent_trigger_service

## What it is

Standalone trigger-host composition retained alongside the consolidated harness.
Active trigger domain logic belongs to `crates/agent_trigger`.

## Start here

- `src/main.rs`: config, database and external-client composition.
- `../../crates/agent_trigger/AGENTS.md`: trigger policy and adapter tests.

## Boundaries

Configure the Lexical facade once at startup. Non-HTTP document exports require
an opaque resolved `SYNC_SERVICE_AUTH_KEY` and the typed sync-service URL; see
`../../crates/lexical_client/README.md`. Authorization remains in the domain.

## Checks

- `cargo test -p agent_trigger_service` against an isolated local MacroDB.
- `cargo test -p agent_trigger --all-features` for the actual trigger adapters.
