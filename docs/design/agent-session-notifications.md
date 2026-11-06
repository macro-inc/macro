# Agent session notifications

System events must be durable without impersonating the session owner. The
`agent_session` domain owns `agent_session_notification`; review adapters write
through its transaction-aware producer port in the state-change transaction.

## Contract

A notification has a UUIDv7 id, session, typed event (`review.decided`,
`review.settled`, `import.planned`, `app.connected`), subject, payload, dedupe
key, wake policy, creation time and producer trace context. Dedupe is scoped to
a session; absent an explicit key it is kind plus subject. Review decisions
include a revision in their key because a stack can be decided in several
batches. Payloads reference review and item ids; final drafts remain available
through GetReview.

Long-running review kinds settle in their own domain. Approving an import
review only starts its write, so its `review.decided` is quiet; the import
produces one `review.settled` per review, carrying the final report
(`ImportSettlement`: outcome, counts, failures, by-hand items, root folder),
in the transaction that ends the write, including a resumed write and one
given up on. A plan presented while planning also produces `import.planned`
once it is ready to approve. Both name the workspace they read (`source`:
`notion`, `linear` or `jira`; absent on events stored before trackers, which
are Notion's). Both wake the session. A settled payload is
either an import report or the review service's own outcome; the enum is
untagged so settlements stored before imports existed still read. Dismissing
an import still wakes, as for other kinds.

The harness serializes delivery with all other session commands. It claims a
bounded batch under a lease using SKIP LOCKED. Waking events start an idle turn;
events arriving during a turn wait until its end and coalesce. Quiet events
join the next real prompt. Email/calendar decisions wake at claim, and their
confirmed results arrive as settled events; adjacent events coalesce. A terminal
turn acknowledges the batch; running turns renew its lease. Quiet batches bind
to the real prompt's action id. Recovery reads that original action before any
rebinding: a completed action is acknowledged, a running action is reattached,
and only an unaccepted or interrupted action is retried. Bound actions reconcile
before fresh events, even if older unclaimed quiet events exist. An interrupted
quiet batch returns to the next real prompt rather than starting a system turn.
Active batches also reconcile durable terminal responses periodically, covering a
completion committed during observer takeover; lease renewal alone is insufficient.
Failed delivery retains it for retry after the lease expires. The stable action
id prevents a retry from repeating an accepted action. Every worker is tracked
and cancellable. Discovery advances a 100-session keyset cursor even when those
sessions cannot accept delivery, wrapping at the end so newer sessions are not
starved by busy or unreachable peers. A sweep retains at most one queued drain
per session and waits at most two seconds, allowing the next sweep to renew
other leases and discover work even if one command is stalled. Renewal errors
are isolated per lease. The duplicate-completion cache retains at most 1,024
recent actions. Notification attachment precedes conversation-journal claims,
so recovering a running quiet batch leaves the next real message queued.

Fresh unreadable payloads remain undelivered with a two-minute retry delay,
without an active lease that would block the session. They retain no action ID.
An already-bound batch stays whole and returns its identity for action
reconciliation, even without decoded events. A finished action acknowledges it;
a running action is reattached and blocks overlapping turns; an unaccepted
opaque action retains its lease until a compatible consumer can retry. Keeping
the batch whole prevents an older consumer from consuming unseen siblings by
finishing a partial action. Invalid trace metadata is ignored without losing
the event. Producer trace context travels with the row and links delivery.

Independent services enqueue through `POST /agent-sessions/internal/notifications`
with internal credentials. The endpoint returns 202 after the idempotent insert;
it is deliberately excluded from the public SDK/OpenAPI surface. For example:

```json
{
  "sessionId": "019a0000-0000-7000-8000-000000000001",
  "subjectId": "notion-connection-1",
  "event": {"kind": "app.connected", "payload": {"app": "Notion"}},
  "dedupeKey": "app.connected:notion-connection-1",
  "wake": true
}
```

`dedupeKey` may be omitted for kind-plus-subject deduplication. Subjects are
bounded to 512 bytes, keys to 1024 bytes, and typed payloads to 64 KiB.

## Identity and transcript

Notification turns record System as their prompter and have no acting user.
A reclaimed legacy hidden prompt loses its former owner authority atomically
with its claim, only while its original action still matches the session's
prompter. Recovery reads that stored identity; quiet real prompts keep theirs.
Owner-only actions remain denied until a subsequent owner prompt. External ACP
runtimes receive an XML block via session/prompt; notification metadata is
server-authored and cannot be accepted through public control. The durable log
uses notification frames, which open turns without creating user messages.
Load replay retains trusted original notification inputs and recognizes only
their complete original prompt inputs, including split echoes. Notification sessions
read the original log across load boundaries so fresh readers retain provenance;
turn numbers are rebuilt from the runtime's replay rather than copied.
Notifications project separately from messages: cards refresh their subject;
other events appear as quiet timeline rows. The fold flattens the protocol’s
`NotificationEvent` tagged enum into the existing `kind`/`payload` shape, so
generated web and SDK clients narrow each payload by kind while stored rows
remain readable. `SessionEventRow` renders an icon, factual one-line summary,
relative time with exact time on hover, and an optional host-provided review
subject action. Failed and unconfirmed outcomes use the error tone; summary
text truncates on mobile without adding another row. A pending review response shows
responding until agent output begins, on desktop and mobile.

Only notification turns may suppress an exact `<noop/>` response, and only if
no tool was called in that turn. This conservatively treats all tool activity
as potentially mutating, including tools without reliable effect annotations.
Noop turns generate no assistant
message, unread, push or activity bump; their outbox outcome records noop.
Ordinary user turns preserve the same literal text. Tool-bearing turns preserve
it as well, since suppressing evidence of work is unsafe.

## Compatibility and scope

Schema additions precede service rollout and use a local lock timeout. Legacy
terminal review notification records are backfilled with their original action
ids, allowing recovery to recognize prior delivery. Still-running legacy reviews
settle through the execution recovery path. A compatibility trigger bridges
terminal writes from older replicas during rollout. Queue reads discard their
former context entries so they cannot restore as empty owner prompts.
Old JSON fields are ignored on reads;
removing them does not require destructive SQL. Notification rows are visible to all
session viewers. The harness produces `app.connected` when the owner connects
an app a session asked for (`POST /agent-sessions/{id}/app-connections`, 202).

## Browser proof

The component fixture uses the real response indicator and session view with a
mock saved-review editor and controlled network outcomes. It covers busy output,
first reply, request rejection, and silent completion on desktop and mobile.

[Desktop responding state](images/agent-session-notifications-desktop.png) ·
[Mobile responding state](images/agent-session-notifications-mobile.png)

The event-row fixture uses the real component, Tailwind styles, and shared
controls. Desktop and touch checks cover every kind, review-subject navigation,
relative/exact time, failures, and phone truncation without horizontal overflow.

[Desktop event rows](images/session-event-rows-desktop.png) ·
[Mobile event rows](images/session-event-rows-mobile.png)
