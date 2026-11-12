# Routine suggestions alerts

Runbook for the routine suggestions monitor in
[`monitors/routine-suggestions.ts`](../../infra/stacks/monitoring/monitors/routine-suggestions.ts).
Its alert links the **Routine suggestions** dashboard.

When a person's inbox connects, agent-harness-service runs one generation:
up to three hidden sessions of the in-process Macro agent, each suggesting
routines for some of the nine surfaces through `macro.routines.suggest`. A
session that suggests nothing is retried once. Surfaces AI leaves empty show
Macro's templates. Routine suggestions are behind the
`enable-routine-suggestions` flag.

Each generation is one trace, and logs one `routine_suggestions.generated`
event:

| What | Search |
| --- | --- |
| Generations | Spans: `resource_name:routine.suggestions.generate`, by `@routine.suggestions.outcome` |
| A generation's sessions | Spans: `resource_name:routine.suggestions.session` in its trace; `@routine.suggestions.ended`, `.tool_calls`, `.turns` |
| Its suggest calls | Spans: `resource_name:routine.suggestions.suggest`; `@routine.suggestion.ok`, `@routine.suggestion.problems` |
| Outcome logs | Logs: `service:agent-harness-service @event:routine_suggestions.generated`, by `@outcome` |
| Rejected suggestions | Logs: `@event:routine_suggestions.suggested @ok:false` |

`ready` means every session suggested something, `partial` that some did not,
`failed` that none did after a retry, and `cancelled` that the process shut
down first.

## Generations failing

More than 10% of the generations that finished in the last hour, plus two,
failed: no session suggested anything, so those people see Macro's templates
only. It notifies; it does not page.

- Open a failed generation's trace and read its session spans.
  `routine.suggestions.ended` says how each stopped: `timed_out` (the 90-second limit), `failed` (the session
  errored) or `finished` without a kept suggestion.
- Many `timed_out` or `failed` sessions at once point at the agent: its model
  provider, agent-harness-service's agent runtime, or the hidden sessions not
  starting. Check the agent-harness-service errors around the same time.
- Sessions that finished with suggest calls but nothing kept mean every
  suggestion failed its checks: see **Rejected suggestions** on the dashboard
  and the `problems` on the suggest spans. A catalog or SDK change can make
  every drafted routine fail.
- `routine.suggestions.inbox_messages` at zero means the inbox was empty or
  could not be read, so the sessions had little to suggest from. Look for `could not read the inbox to suggest
  routines` warnings and email-service health.
- Levers: a person keeps Macro's templates either way, and generation runs
  once per person, so failed people are not retried automatically. To stop
  new generations, turn off `enable-routine-suggestions`.
