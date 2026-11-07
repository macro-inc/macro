# JavaScript execution: domain

## What it is

Part of agent code mode: the domain half of bounded JavaScript execution.
It decides whether a run is admitted, cancels it, and defines the request,
outcome and failure types plus the ports a runner implements. The Deno runner
is `crates/agents/code_execution_outbound`.

## Start here

- `src/service.rs`: admission, concurrency limits and cancellation.
- `src/ports.rs`: `ProgramExecutor` (implemented by `ExecutionService`), and
  the `CodeRunner` and `ProgramChecker` ports the Deno runner implements.
- `src/models.rs`: `ExecuteRequest`, `RunEnvironment`, `Limits`, `Outcome`.
- `src/operations.rs`: the generated operation catalog (labels, routes, read or
  write) and the SDK fingerprint.

## Boundaries

- Depends on: `code_mode_assets` for the generated operation catalog and SDK
  declarations. No process, filesystem or network code.
- Used by: `crates/agent_code_mode` and `services/agent_harness_service`.

## Checks

- `cargo test -p code_execution_core`
- Runner behaviour is tested in `code_execution_outbound`; see its `AGENTS.md`.
