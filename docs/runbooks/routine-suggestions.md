# Routine suggestions alerts

Runbook for the routine suggestions monitor in
[`monitors/routine-suggestions.ts`](../../infra/stacks/monitoring/monitors/routine-suggestions.ts).
Its alert links the **Routine suggestions** dashboard.

When a person's inbox connects (onboarding), each night in their time zone,
and when they ask for fresh suggestions (manual), agent-harness-service runs
a generation (`crates/suggestion_generation`):
a suggestions session and one routines session of the in-process Macro agent for all
nine surfaces (outside onboarding once a week; nightly runs are for people on a paid
plan), which suggests through `macro.routines.suggest` only the few routines the
person's mail calls for, so most surfaces stay without one. A nightly or manual routines
session also reviews and retires earlier suggestions and adds at most two. At onboarding
a routines session that suggests nothing is retried once; one that kept a suggestion and
was then cut off at its time limit is not (its `suggestion.session` span ends
`timed_out`). Surfaces AI leaves empty show Macro's templates.
Routine suggestions are behind the `enable-routine-suggestions` flag.
With `routine-suggestions-find-work` also on, an onboarding runs one
routines session that picks catalog routines at once and, once one model
call (asked once more when its answer strays from the list's shape) has
listed the recurring work in the person's last 30 days of mail (what reached
them and what they sent), up to three
that draft, each from its share of the streams; one drafts from the newest
mail when none are found (`suggestion.session.part` is `picks` or
`drafts`; `whole` otherwise). Nightly and manual runs keep one session.

Each generation is one trace, and logs one `routine_suggestions.generated`
event with its `trigger`:

| What | Search |
| --- | --- |
| Generations | Spans: `resource_name:suggestion.generation`, by `@suggestion.generation.outcome` and `@suggestion.generation.trigger` |
| A generation's sessions | Spans: `resource_name:suggestion.session` in its trace; `@suggestion.session.kind`, `.ended`, `.tool_calls`, `.turns` |
| Finding the work | Spans: `resource_name:routine.find_work`, by `@routine.find_work.outcome` (`found`, `none`, `failed`, `timed_out`, `cancelled`, `heartbeat_lost`) and `.streams`; an error status for `failed`, `timed_out` and `heartbeat_lost` |
| Its suggest calls | Spans: `resource_name:routine.suggestions.suggest`; `@routine.suggestion.ok`, `@routine.suggestion.problems` |
| Outcome logs | Logs: `service:agent-harness-service @event:routine_suggestions.generated`, by `@outcome` |
| Rejected suggestions | Logs: `@event:routine_suggestions.suggested @ok:false` |

In the log event, `ready` means every routines session kept a suggestion,
`partial` that some did not (only when a layout splits the surfaces across
sessions, or the picking and drafting sessions of an onboarding that finds the
work, where a drafting session whose streams the catalog already covers rightly
keeps none), `failed` that none did (after a retry at onboarding),
`cancelled` that the process shut down first (or, for an onboarding that
finds the work, while a routines session was still running), and
`interrupted` that its heartbeat was lost. A nightly run that finds
nothing missing is `failed` by this measure, so the generation metrics and
the alert below count onboarding runs only.

## Generations failing

More than 10% of the generations that finished in the last hour, plus two,
failed: no session suggested anything, so those people see Macro's templates
only. It notifies; it does not page.

- Open a failed generation's trace and read its session spans.
  `suggestion.session.ended` says how each stopped: `timed_out` (the
  240-second limit), `failed` (the turn failed, or stopped to wait for an
  approval or answer nobody gives; `suggestion.session.reason` names which),
  `delivery_unknown`, `cancelled` (a deploy), `interrupted` (its process
  died), or `finished` without a kept suggestion.
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
- `routine.find_work` spans that end `failed` or `timed_out` (120 s) leave the
  one drafting session to the newest mail alone, in place of up to three
  drafting from shares of the streams found. Under it,
  `routine.suggestions.find_work` counts the messages read (`.messages`,
  `.texts`, `.sent`), the streams and the model calls (`.tries`); its
  `routine.suggestions.read_month` and `.read_sent` children time the mail
  reads (a failed read of either fails the finding) and
  `routine.suggestions.list_work` each model call. Check email-service health
  for the first and the model provider for the second.
- Levers: a person keeps Macro's templates either way. Onboarding runs once
  per person; their nightly runs keep trying. To stop new routines sessions,
  turn off `enable-routine-suggestions`; to go back to one routines session at
  onboarding, turn off `routine-suggestions-find-work`.
