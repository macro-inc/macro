# Outlook sync alerts

Runbook for the Outlook mailbox sync monitors in
[`monitors/outlook-sync.ts`](../../infra/stacks/monitoring/monitors/outlook-sync.ts).
Every alert links the **Outlook sync** dashboard; mailboxes are named by their
opaque `link_id`.

The email-service pubsub workers report each Outlook mailbox about once a
minute in an `outlook mailbox health` log (backlog, parked work, oldest wait,
recent imports, `sync_active`, `needs_reauth`), and trace each unit of sync
work as an `outlook.sync.discover`, `.enumerate`, `.reconcile` or `.project`
span with `outlook.outcome` and `outlook.defer_reason`. Datadog renames the
Graph and token spans, so find them by their fields:

| What | Search |
| --- | --- |
| A mailbox's snapshots | Logs: `"outlook mailbox health" @link_id:<id>` |
| Its sync work | Spans: `resource_name:outlook.sync.* @mailbox.link_id:<id>` |
| Its Graph requests | Spans: `@outlook.throttle_origin:* @mailbox.link_id:<id>` |
| Token lookups | Spans: `@outlook.token_cache:*` |
| Deferral logs | Logs: `"mailbox sync work deferred"`, grouped by `@defer_reason` |

Failed, deferred, throttled and slow (over 5 s) Outlook spans are always
indexed, with their whole trace; successes are sampled.

Sync work defers itself: a refused or failed unit is parked and retried
later, so most of these alerts clear without action. Don't edit queue rows in
production.

## Stalled mailbox

A mailbox has had a message claimable for 15 minutes and imported none in that time.

- Read its latest snapshot: `leased` above zero with no imports means workers
  claimed work and never finished it; zero `leased` means nothing is claiming.
- Check that `email-service-pubsub-workers-prod` is running, and whether its
  `outlook.sync.reconcile` spans for the link exist. Group them by
  `@outlook.outcome` and `@outlook.defer_reason`: repeated deferrals point at
  the cause; no spans at all means no worker is claiming this mailbox.
- A claim needs the link active, the row in the link's current sync
  generation, and its wait over. A reconnect that bumped the generation can
  leave older rows behind.
- Levers: fix the cause (database, token, Graph). Restarting the workers frees
  stuck leases; the work is claimed again.

## Parked too long

A message is parked more than 30 minutes into the future. The mailbox gate
parks for at most its 10-minute window and failures park for 30 seconds to 10
minutes, so this is a long Graph `Retry-After`, which the worker honours for up
to a day, or a bug.

- Find the deferral: `resource_name:outlook.sync.* @mailbox.link_id:<id>
  @outlook.defer_seconds:>1800`, and its `@outlook.defer_reason`. For
  `graph_throttled`, the Graph span's `@outlook.retry_after_seconds` and
  `@graph.request_id` say what Graph asked for; give the request id to
  Microsoft support if it looks wrong.
- Levers: parked work resumes on its own when its wait ends. If the wait is
  wrong, fix the code that set it.

## Graph throttling

Graph itself throttled more than 2% (warning) or 10% (critical) of the
Outlook requests that reached it in 15 minutes. The ratio adds 100 requests to
the denominator, so a quiet quarter hour needs a few more 429s to alert. The
Redis gate (`crates/email_api_client/src/outbound/microsoft_gate.rs`)
holds every mailbox below Graph's published limits for all Microsoft mail and
calendar callers together, and a Graph 429 cools the mailbox down, so Graph
should not throttle.

- On the dashboard, compare **Throttled Graph requests by origin**: `gate`
  refusals are the gate working; `graph` is what this alert counts.
- Group `@outlook.throttle_origin:graph` spans by `@mailbox.link_id` and route
  (resource). One mailbox points at that mailbox's limits; every mailbox
  points at a change in Graph or in the gate.
- Look for Graph calls that bypass the gate (a new caller using a bare token)
  or for the same app registration used outside production against the same
  mailboxes.
- Levers: lower the gate's per-mailbox limits. Throttled work is parked and
  retried, so sync slows but loses nothing.

## Token failures

authentication-service could not supply more than 1% (warning) or 5%
(critical) of the Microsoft tokens Outlook sync asked for in an hour; normally
about 0.1% fail. The ratio adds 100 lookups to the denominator, so a quiet hour
needs a few more failures to alert.

- Group `@outlook.token_cache:* @outlook.outcome:unavailable` spans by
  `@http.status_code`. 503 is authentication-service's own transient
  failure; no status means the request never got an answer.
- Check authentication-service: errors on
  `GET /auth/internal/microsoft_access_token`, its recent deploys, and
  Microsoft's token endpoint (refresh failures in its logs).
- Levers: roll back or fix authentication-service. Each failure defers its
  sync work for 30 seconds.

## Reauthorization

More Outlook mailboxes need reauthorization than an hour ago. Their sync stops
until each user reconnects, so a spike is user-visible.

- List them: `env:prod "outlook mailbox health" @needs_reauth:true`,
  grouped by `@link_id`.
- Several at once point at a shared credential problem rather than users:
  the Microsoft app registration (an expired client secret, revoked consent),
  the encrypted grant store, or a refresh regression in a recent
  authentication-service deploy. Check its logs for refresh errors.
- Levers: fix the shared credential or roll back. Mailboxes already marked
  need their users to reconnect.

## Persistence errors

More than 500 units of Outlook sync work in 15 minutes were deferred because
their database writes failed. Projection is left out: it reports a failed
Kafka, SQS or HTTP effect as a persistence deferral too.

- Group the deferral logs (`"mailbox sync work deferred"`) for
  `persistence` by their database error kind or SQLSTATE: lock timeouts and
  serialization failures point at contention; connection errors at the pool or
  the database.
- Follow the [MacroDB runbook](macrodb.md) for locks, connections and load.
- Levers: as in the MacroDB runbook. Each deferral retries after 30 seconds.
