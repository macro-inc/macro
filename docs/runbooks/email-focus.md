# Email Focus rollout

The Email Focus worker (`services/email_focus_worker`) classifies mail for the
Focus tab of inboxes in the `enable-email-focus` rollout: an inbox is in while
its owner or a user it is linked to has the flag and has used Macro in the
last 7 days (had it open, or changed something themselves; work an agent
did for them does not count). So a secondary inbox follows the person whose
tab lists it, and an inbox whose owner and linked users are all outside the
rollout or away is not classified, backfilled or swept; it is backfilled when
one of them returns. `FOCUS_ACTIVE_DAYS` (7) sets the window. The rollout
widens in steps; each step goes on only while the numbers below hold.
They are on the **Email Focus rollout** Grafana dashboard
(`/d/email-focus-rollout`), and the rules in the `Email Focus` alert group fire
on them. The rules notify through GoAlert and never page: an alert means hold
the next step, not wake someone up.

## Where the numbers come from

The worker publishes CloudWatch custom metrics in `Macro/EmailFocus` (us-east-1),
dimension `Environment` = `prod` or `dev`, once a minute and once more when
it stops. Every counter goes out each minute, 0 when idle, so no data means
the worker is not publishing. A local worker only logs them. Calls cut off
because the worker is stopping are not counted as failures. Each publish also logs
"focus usage this minute" with that minute's tokens and dollars. The metric
names, units and meanings are in `services/email_focus_worker/src/metrics.rs`;
the thresholds are in `infra/stacks/observability/nixos/grafana-provisioning/email-focus.nix`.

Cost uses the prices in `ai_effective_pricing`, read once per model in the
background; a changed price is picked up when the worker restarts. Calls made
before a model's price is read, or while a failed read is retried, cost
nothing, so a due date model's first call each start is not counted. A model
with no stored price is logged ("no stored price") and its cost is not
counted.

## Go/stop numbers

| Check | Go while | First look |
| --- | --- | --- |
| Cost per enrolled inbox per day | at most $0.03 | The Tokens panel: which of Jev and the due date grew. A backfill wave of newly enrolled inboxes raises it for a day. |
| Classifier unavailable or rejecting | under 1% of calls, hourly | Jev's API errors in the worker's `jev.evaluate` spans. Unavailable threads are retried by the next sweep. |
| Due dates failing | under 5% of asks, hourly | `email_focus.due_date` spans, and the agent harness's `universal_input/thread-due-date` errors and latency. A failed ask stores the thread without a date. |
| Mail waiting to be classified (p95) | under 2 minutes | `email_focus.queue` spans' `event_age_ms`, the Event stream lag panel, and classifier latency. |
| Sweep duration | under 30 minutes | The "focus sweep finished" log (`inboxes`, `candidates`, `stopped_early`) and the `sweep` span; the stale-thread read below. |
| Sweep failures | none | The "focus sweep failed" error log, and "focus sweep left out an inbox" for an inbox whose threads could not be read (the sweep goes on to the others; `inboxes_failed` on "focus sweep finished"). |
| New inbox backfill time (p95) | under 15 minutes | `email_focus.backfill` spans: `candidates` per pass, and the classifier. Only inboxes that joined the rollout while the worker ran are timed; the inboxes its first look finds after a start are not. |
| Stale-thread read (p95) | under 500 ms | MacroDB CPU and load on the Prod alerts dashboard; the read's plan for a large inbox. |
| Worker restarts | at most 3 in 30 minutes | ECS stopped-task reasons for `email-focus-worker`, and the worker's last logs. A start counts only once the worker is up; a worker that fails earlier (configuration, database) shows only in ECS. No data for 30 minutes means the worker isn't publishing, and the rule fires. |
| Focus tab opened empty | under 5% of opens | PostHog, from the web app's Focus tab events. |

Traces: see "Email Focus live updates" in `docs/agent-guide/observability.md`.

## Stopping the rollout

Lower the `enable-email-focus` rollout percentage in PostHog; the same flag
shows the tab. The worker evaluates the flag locally from definitions it
fetches from PostHog every 5 minutes (`feature_flags::outbound::posthog_local`),
so it keeps classifying a removed user's new mail, in their own inboxes and
those linked to them, for about 5 minutes,
as long as its polls succeed: a failed poll keeps the last definitions, for up
to an hour (below). A `feature_flags.definitions_poll` span after the change
shows the worker has it. An inbox someone still in the rollout also reads (its
owner, or another user it is linked to) goes on being classified after that.
Stored classifications stay.

If the worker can't fetch the definitions for an hour, or the flag gains a
condition it can't evaluate locally (a cohort, variants, an unknown field),
every user reads as unknown and nothing is classified: the backfill's
`EnrollmentUnknown` count rises and the worker logs the reason
(`feature_flags.definitions_poll` spans, "can't be evaluated locally").
