# Outlook sync alerts

Runbook for the Outlook mailbox sync monitors in
[`monitors/outlook-sync.ts`](../../infra/stacks/monitoring/monitors/outlook-sync.ts).
Every alert links the **Outlook sync** dashboard; mailboxes are named by their
opaque `link_id`.

The email-service pubsub workers report each Outlook mailbox about once a
minute in an `outlook mailbox health` log (backlog, parked and abandoned work,
oldest wait, recent imports, `sync_active`, `needs_reauth`, `mailbox_unavailable`, `watch_failures`), and trace each unit of sync
work as an `outlook.sync.discover`, `.enumerate`, `.reconcile` or `.project`
span with `outlook.outcome` and `outlook.defer_reason`. Datadog renames the
Graph and token spans, so find them by their fields:

| What | Search |
| --- | --- |
| A mailbox's snapshots | Logs: `"outlook mailbox health" @link_id:<id>` |
| Its sync work | Spans: `resource_name:outlook.sync.* @mailbox.link_id:<id>` |
| What Graph holds | Spans: `resource_name:outlook.sync.discover @mailbox.link_id:<id>`, field `@outlook.provider_item_count` (per folder: `email_mailbox_folders.total_item_count`) |
| Its Graph requests | Spans: `@outlook.throttle_origin:* @mailbox.link_id:<id>`; a refused one names Graph's `@graph.error_code` |
| Token lookups | Spans: `@outlook.token_cache:*` |
| Deferral logs | Logs: `"mailbox sync work deferred"`, grouped by `@defer_reason` |
| Accounts Graph serves no mailbox for | Logs: `"outlook mailbox health" @mailbox_unavailable:true`; their probes: spans `resource_name:outlook.sync.discover @outlook.defer_reason:no_mailbox`, field `@graph.error_code` ([No mailbox](#no-mailbox)) |
| Its subscription upkeep | Spans: `resource_name:outlook.subscription.maintain @mailbox.link_id:<id>`, field `@outlook.upkeep_failures` (failed runs in a row); mailboxes whose upkeep Graph keeps refusing or failing: `"outlook mailbox health" @watch_failures:>0` (throttled and token-deferred runs are not counted; find those by `@outlook.defer_reason` on the spans) |

Failed, deferred, throttled and slow (over 5 s) Outlook spans are always
indexed, with their whole trace; successes are sampled.

Re-importing folders whose first import was cut short has its own runbook:
[Outlook folder re-import](outlook-folder-reimport.md).

Each mailbox's Graph subscription is renewed every 12 hours. An upkeep run
that fails waits 30 s, doubling with each failed run in a row: up to 30
minutes after a transient failure (Graph 5xx, no answer) and up to 12 hours
after a refusal (a 403 or 404 `ExtensionError` on `POST /subscriptions`, any
other 4xx), which Graph repeats until something changes for the mailbox.
Throttling and token failures keep their own delays and are not counted. The
snapshot's `watch_failures` counts the failed runs; while it is above zero the
mailbox may get no change notifications and syncs by polling alone (each
folder about every 2 minutes). A run that works, a reconnect or a lifecycle
event resets it.

Sync work defers itself: a refused or failed unit is parked and retried
later, so most of these alerts clear without action. Don't edit queue rows in
production. An importing folder reads its next page only while its mailbox has
fewer than 200 messages ready to import; until then its enumerate spans read
`@outlook.outcome:paced`, which is the import keeping pace, not a stall.
Messages backed off after their own failures don't count. Importing folders
are claimed ahead of finished folders' polls that came due less than five
minutes earlier, so a walk reads its next page soon after its import has
room; a poll due longer than that goes first again. With the live pass
on, the folder's new mail does not wait for its walk
([New mail during an import](#new-mail-during-an-import)).

A message whose own reads keep failing stops retrying: after 3 refusals Graph
won't change (`permanent`, such as an undecodable response, or `forbidden`, a
403 on that one message) or 50 failures of any other kind (about a day of
backoff). A value the database refuses (`unstorable`: SQLSTATE class 22, a NOT
NULL or CHECK violation) is refused the same way every time, so it stops like
a refusal Graph won't change: 3 tries, 10 minutes apart. NUL characters, which
no PostgreSQL text holds, are removed from a message's text, headers, names
and attachment metadata before the write. A message whose claims keep ending
with no outcome at all (the worker reading it stopped, as one that runs out of
memory does, and its lease expired) stops after 5 such claims in a row, unread
(`unfinished`): a read that kills its worker would otherwise kill one every
few minutes forever. It is then `abandoned`: the span
records `@outlook.outcome:abandoned`, a `"mailbox message abandoned"` WARN
names its `@defer_reason` and attempts, and
the health snapshot counts it in `abandoned` instead of `queued`. The next
Graph change to the message, a resync or a reconnect queues it again with
fresh attempts. Throttling and token failures never count toward this, and a
Graph 5xx or 408, or a request Graph never answered (connection error, timeout),
stops counting once its backoff reaches 30 minutes: during a Microsoft outage
queued messages keep retrying every 30 minutes and are never abandoned. An
invitation whose MIME source Graph won't return is retried twice
(`calendar_parts`), then imported without its calendar parts.

An attachment whose copy keeps failing to download or store stops being tried
the same way, counted on the attachment rather than on the projection event
that tries it: after 3 refusals (`permanent`, `forbidden` or a 404) or 50
failures of any other kind, a download Graph keeps cutting off included (about
a day of one event's retries). Throttling, token failures, a lost lease
and lock timeouts never count. The attachment keeps its upload claim and gets
`upload_abandoned_at`, an `"outlook attachment abandoned"` WARN names its
`@attachment_id`, failures and `@defer_reason`, and the projection that waited
on it completes. Nothing revives it: the app shows it as an attachment Macro
holds no copy of, and opening one downloads it from Graph on demand.

A projection event (what applies a synced change to what the app shows:
reindexing, refreshes, notifications, CRM jobs, attachments) that keeps
failing stops the same way as a message read, with the same bounds and
backoff, and so does one whose claims keep ending with no outcome
(`unfinished`, a worker that stopped mid-projection, five times). Its entry
is deleted, and a `"mailbox projection abandoned"` WARN names its `@link_id`,
`@event_id`, `@event_kind`, attempts and `@defer_reason`. The message itself
is already stored. Giving up skips whatever effects the event had left:
search and open views keep the message's previous state until a later event
for the link supersedes it, which any further change to the message or its
thread queues. Effects an earlier attempt already completed stay done, so a
notification or activity event can have gone out before, say, its
attachments failed; one that had not gone out is not sent.

A message Graph answers 404 for is settled as gone (`@outlook.outcome:absent`).
Live work is read twice more first, 30 and 60 s apart
(`@outlook.defer_reason:location_unsettled`); import work settles at once.
Deleted Items can list entries Graph never serves as messages, so its stored
messages can stay below its `@outlook.provider_item_count`: every import
settles those entries this way and never stores them.

## New mail during an import

A folder's import round is one Graph delta snapshot: mail that arrives while
it runs is listed only once the round reaches its end, and a large folder's
round lasts as long as its import. With the PostHog flag
`enable-outlook-import-live-pass` on, an import round reads the folder newest
first, and from its first page each importing folder also gets a live pass
(`email_sync_streams.kind = 'mail_folder_live'`): a delta round of only the
mail received since five minutes before the import round started, read like
a synced folder (woken by change notifications, live Graph budget, never
paced), whose messages import as new mail. The pass is deleted when the
folder's import round ends. Its enumerate spans read `@outlook.stream_kind:mail_folder_live`;
`@outlook.live_pass_opened` marks the page that opened one.

- The flag is evaluated for the service context `outlook-mailbox-sync`. Turn
  it on for dev with a release condition on the person property
  `environment = dev`; widen it to production after a dev round trip
  (connect a large Outlook mailbox, send it mail during the import, see the
  mail arrive within a minute). A round already running when it turns on
  gets its pass at its next page, still from the round's start
  (`round_started_at`); a round that began before that column existed is
  covered only from that page, until a resync or re-import restarts it.
- Turn it off in PostHog: the workers read it every minute
  (`outlook.feature_flag.refresh` spans with
  `@feature_flag.key:enable-outlook-import-live-pass`), stop claiming live
  passes and start new import rounds unordered. Open passes are deleted as
  their rounds end; nothing needs cleaning up. A worker that cannot read the
  flag treats it as off and logs "could not read the outlook import live pass
  flag".

## Reading notified messages

A Graph change notification makes every folder of its mailbox due, and a
folder waits its turn behind every other mailbox's due folders before it is
read. With the PostHog flag `enable-outlook-notified-message-reads` on, the
webhook also queues the message the notification names as live work, which
the sync loops read before any import work, so new mail is stored on the next
message read. Folder polls stay as the fallback for missed notifications.

- The flag is evaluated by the email-service API for the service context
  `outlook-mailbox-sync`. Turn it on for dev with a release condition on the
  person property `environment = dev`; widen it to production after a dev
  round trip (send the Outlook test inbox mail, see it in the app within
  seconds). Turn it off in PostHog; the API reads it every minute
  (`outlook.feature_flag.refresh` spans), and rows already queued are read as
  usual.
- Nothing is queued for a mailbox whose folders are still importing, or that
  already has 50 live messages due; its folder pages list the rest.
- Watch: `outlook.subscription.notify` spans count `@outlook.messages_queued`;
  `outlook.sync.reconcile` spans with `@outlook.from_notification:true` carry
  `@outlook.notification_lag_ms`, notification to stored. `@outlook.outcome:unsynced`
  marks a notified message in a folder the catalog does not list, settled
  without storing it.

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
parks for at most its 10-minute window and failures park for 30 seconds to 30
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
should not throttle. An import reads within a smaller share of those limits
(two of the three in-flight slots, 7,500 of the 9,000 requests per window),
so calendar sync, new mail and the user's own actions keep the rest.

- On the dashboard, compare **Throttled Graph requests by origin**: `gate`
  refusals are the gate working, and a mailbox that is importing shows many;
  `graph` is what this alert counts.
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
until each user reconnects, so a spike is user-visible. Sync claims skip a
flagged mailbox, so its queued work waits (`queued` stays above zero) without
asking authentication-service for tokens; it resumes once a reconnect or a
token that works again clears the flag.

- List them: `env:prod "outlook mailbox health" @needs_reauth:true`,
  grouped by `@link_id`.
- Several at once point at a shared credential problem rather than users:
  the Microsoft app registration (an expired client secret, revoked consent),
  the encrypted grant store, or a refresh regression in a recent
  authentication-service deploy. Check its logs for refresh errors.
- Levers: fix the shared credential or roll back. Mailboxes already marked
  need their users to reconnect.

## No mailbox

Graph answers 404 to an account's Inbox, and to every other mailbox call,
when it serves the account no mailbox: no Exchange Online licence, an
inactive or deleted mailbox, or one hosted on premises (`@graph.error_code`
is usually `MailboxNotEnabledForRESTAPI`). Folder discovery then marks the
link (`email_links.mailbox_unavailable_at`; the snapshot's
`mailbox_unavailable`), and every other kind of sync work skips it: folder
pages, message reads, contacts and photos, drafts, commands, settings and
subscription upkeep wait unclaimed, so the mailbox sends Graph nothing but
the probe. Discovery looks again after waiting as long as the link has been
marked, 30 s at first and at most 12 hours
(`@outlook.defer_reason:no_mailbox`, `@outlook.defer_seconds`). Any other
discovery failure, a 5xx included, is retried as before and never marks the
link. Settings shows the inbox as "No Outlook mailbox for this account",
and the Integrations row asks for attention.

The first discovery that finds the Inbox clears the mark and makes the
link's folder, contacts, settings and subscription work due at once, with
the subscription's failures reset; message rows keep their own retry times.
A reconnect clears it too and makes that work, and discovery, due at once.

- List them: `env:prod "outlook mailbox health" @mailbox_unavailable:true`,
  grouped by `@link_id`.
- Nothing in Macro fixes it: the account's Microsoft 365 administrator
  assigns an Exchange Online licence (or restores the mailbox). Sync resumes
  by itself within the probe's wait, at most 12 hours; a reconnect resumes it
  at once.

## Persistence errors

More than 500 units of Outlook sync work in 15 minutes were deferred because
their database writes failed. Failed Kafka, SQS or HTTP effects are deferred
as `effect` instead and don't count here, and neither do values the database
refuses (`unstorable`). A message reconciliation that hits one stops after 3
tries, as does an attachment's; other sync work (catalogs, folder streams,
projections) keeps retrying it, and no monitor counts it: search `"mailbox sync work deferred"` and
`"mailbox sync work failed"` logs for `@defer_reason:unstorable`.

- Group the deferral logs (`"mailbox sync work deferred"`) for
  `persistence` by their database error kind or SQLSTATE: lock timeouts and
  serialization failures point at contention; connection errors at the pool or
  the database.
- Follow the [MacroDB runbook](macrodb.md) for locks, connections and load.
- Levers: as in the MacroDB runbook. Each deferral retries after 30 seconds,
  doubling for a message that keeps failing.
