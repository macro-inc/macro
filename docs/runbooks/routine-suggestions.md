# Routine suggestions alerts

Runbook for the routine suggestions monitor in
[`monitors/routine-suggestions.ts`](../../infra/stacks/monitoring/monitors/routine-suggestions.ts).
Its alert links the **Routine suggestions** dashboard.

When a person's inbox connects (onboarding), and each night in their time
zone, agent-harness-service runs a generation (`crates/suggestion_generation`):
an ideas session and up to three routines sessions of the in-process Macro
agent, each routines session suggesting for some of the nine surfaces
through `macro.routines.suggest`. A nightly routines session also reviews and
retires earlier suggestions. At onboarding a routines session that suggests
nothing is retried once. Surfaces AI leaves empty show Macro's templates.
Routine suggestions are behind the `enable-routine-suggestions` flag.

Each generation is one trace, and logs one `routine_suggestions.generated`
event with its `trigger`:

| What | Search |
| --- | --- |
| Generations | Spans: `resource_name:suggestion.generation`, by `@suggestion.generation.outcome` and `@suggestion.generation.trigger` |
| A generation's sessions | Spans: `resource_name:suggestion.session` in its trace; `@suggestion.session.kind`, `.ended`, `.tool_calls`, `.turns` |
| Its suggest calls | Spans: `resource_name:routine.suggestions.suggest`; `@routine.suggestion.ok`, `@routine.suggestion.problems` |
| Outcome logs | Logs: `service:agent-harness-service @event:routine_suggestions.generated`, by `@outcome` |
| Rejected suggestions | Logs: `@event:routine_suggestions.suggested @ok:false` |

In the log event, `ready` means every routines session kept a suggestion,
`partial` that some did not, `failed` that none did (after a retry at
onboarding), and `cancelled` that the process shut down first. A nightly run
that finds nothing missing is `failed` by this measure, so the generation
metrics and the alert below count onboarding runs only.

## Generations failing

More than 10% of the generations that finished in the last hour, plus two,
failed: no session suggested anything, so those people see Macro's templates
only. It notifies; it does not page.

- Open a failed generation's trace and read its session spans.
  `suggestion.session.ended` says how each stopped: `timed_out` (the
  240-second limit), `failed` (the session errored) or `finished` without a
  kept suggestion.
- Many `timed_out` or `failed` sessions at once point at the agent: its model
  provider, agent-harness-service's agent runtime, or the hidden sessions not
  starting. Check the agent-harness-service errors around the same time.
- Sessions that finished with suggest calls but nothing kept mean every
  suggestion failed its checks: see **Rejected suggestions** on the dashboard
  and the `problems` on the suggest spans. A catalog or SDK change can make
  every drafted routine fail.
- `routine.suggestions.inbox_messages` (on the `routine.suggestions.brief`
  span) at zero means the inbox was empty or could not be read, so the
  sessions had little to suggest from. Look for `could not read the inbox to
  suggest routines` warnings and email-service health.
- Levers: a person keeps Macro's templates either way. Onboarding runs once
  per person; their nightly runs keep trying. To stop new routines sessions,
  turn off `enable-routine-suggestions`.
