# agent_wakes

## What it is

Part of agent dashboards: wake telemetry for agent accounts (`User."isAgent"`,
the accounts muppet teammates run as). Stores the latest muppet `WakeRecord`
(v1) per wake and one redacted trace per wake, and serves them to the agent
and the owners and admins of its teams.

## Start here

- `src/domain/service.rs`: who may write and read, record validation, the
  rule that a trace belongs to a recorded wake, and that a live trace sent
  after the `end` record is dropped.
- `src/domain/record.rs`, `src/domain/trace.rs`: the wire formats. Their source
  is muppet (`agent-teammates/muppet/packages/lib/utilities/telemetry/record.ts`
  and `utilities/traces/trace.ts`); keep them in step.
- `src/outbound/postgres.rs`: `agent_wakes`; the upsert never replaces a later
  phase (`start` < `session` < `end`) or another system's wake.
- `src/inbound/axum_router.rs`: `/agents/{agent_user_id}/wakes…`, mounted by
  `agent-harness-service` (`src/agent_wakes.rs` there).

## Scope

- Owns: the `agent_wakes` table and the `agent-wakes/` trace objects.
- Not here: producing records and traces (redaction included) →
  `agent-teammates/muppet` (`macroSink`, `utilities/traces`); rendering them →
  the `wakes` and `trace` widgets in `apps/web/src/features/dynamic-ui`.

## Checks

- `cargo test -p agent_wakes --all-features` (`SQLX_OFFLINE` unset).

## Gotchas

- Every route answers 404 while `enable-agent-dashboards` is off for the
  caller, and to anyone who may not read the agent, so it never reveals which
  agent accounts exist. Writers who may read get 403.
- Traces live in the agent session changes bucket under `agent-wakes/`, expired
  30 days after their last upload by a lifecycle rule
  (`infra/stacks/agent-harness-service`). A row whose trace expired keeps
  `trace_updated_at`; reading the trace then answers 404.
- Never record the agent id on a span: a Macro user id contains an email.

## Related

- Rules: `.agents/rules/observability.md`, `.agents/rules/rust/architecture.md`
