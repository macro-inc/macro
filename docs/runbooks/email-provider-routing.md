# Mailbox provider routing

Work rows derive provider metadata from their immutable link through the
routing trigger, including old-binary inserts. Stream rows were Outlook-only
before this rollout. Legacy reconciliation rows can carry the metadata-only
Outlook default for another provider; claims relabel at most 64 per due window,
return Progress and immediately poll again. Work that becomes due later follows
the same path. No background repair job, cursor, completion marker or runtime
DDL is needed. Legacy Gmail reconciliation rows have no native consumer on
main or here; keep them and repair routing rather than deleting data.

Single-claimer synthetic-harness transition measurements:

- A one-million-row legacy mislabelled prefix takes 169–184 seconds (about
  17–18 seconds per 100k). Relabelled entries leave dead index entries until
  vacuum; sampled calls reached 11,065 buffers. Record that one-time prefix
  separately from the standard claim-window gate.
- Parking 102,000 due live-stream rows of links needing reauthentication takes
  22.7 seconds before healthy work is acquired, with none left unparked.
- For 102,000 inactive-link reconciliation rows, healthy live work is acquired
  after 11.9 seconds and 68,000 live-order rows parked. The 34,000 import-order
  rows remain behind live work and are maintained later.

The authorized hosted-dev counts are zero for legacy non-Outlook reconciliation
rows and for due ineligible catalog, folder, live-pass and live/import message
rows. Production counts require explicit permission and remain unmeasured.

## Earlier local preview revisions

These unmerged revisions were never deployed. Removing migrations 250,
253–256, 260–262 and 267 and editing 251/252/259 or the metadata comment in
20261119060448_imap_verification_limits makes SQLx reject local databases that
already applied the old set: applied-but-missing versions and changed checksums
are both errors. Full migration requires a fresh database or an explicitly
approved reset of a disposable database. Never edit the migration ledger to
hide incompatibility; preserve needed data and volumes.

The preserved preview keeps its data and old ledger. It cannot claim a full
migration pass on the revised source. Fresh owned scratch databases provide
full migration proof. Any separately authorized scoped schema adaptation of
the preserved preview must be recorded as local-only, not a successful full
SQLx migration or a production rollout rehearsal.

## Connection recovery leases

Migration 20261119060030 remains unchanged. Forward migration 20261123181252
adds nullable lease fields and the stable two-minute recovery default; 181253
and 181254 create the due index before dropping the old pending index, both
concurrently in separate files.
If the new build is interrupted, inspect and drop only its INVALID index before
retrying. Existing completed receipts and pending attempts are preserved.
A promotion that loses its lease must not bypass the nonce fence: allow recovery
to reclaim it and replay the same verification, rather than create a new attempt.
Earlier preview incompatibilities listed above remain separate from this additive
upgrade; do not reset the kept preview or change its migration ledger.

## Draft and command claim rollout

Migrations 20261123181255–181263 add nullable routing/local blocker fields and
new concurrent indexes; no applied migration changes. Draft claims reserve 32
legacy NULL-provider slots beside 32 native slots; command claims reserve 16
legacy slots beside 32 native slots to bound routing writes. A populated native
queue cannot starve the transition. New/old writers derive routing through insert hooks;
existing NULL rows are labelled in bounded claim maintenance. Keep the NULL
indexes until an authorized production check and writer review under
`mac-imap-smtp.114`; retained terminal NULL metadata may need a separately reviewed
bounded completion before the all-row zero check. No production check is implied
by the local synthetic evidence.

Migration 20261123181266 adds the command live-lease range index concurrently.
Draft exclusion uses its link/generation/expiry range before target primary-key
probes; expired uncleared leases stay outside that live range. Keep older command
indexes for rolling binaries. Check the new index is valid before the new
queries run; rollback drops only this new index after rolling back the reader.

Target FIFO facts have a separate rollout in 20261123181264–181265. The metadata
migration installs database insert and parent-transition triggers, then fills
only targets of pending/running/confirming commands in the same transaction.
It takes the command parent lock before the target table and bounds acquisition
and each statement at five seconds. A timeout rolls back the entire metadata
migration; do not bypass it by editing the ledger or deploying a new binary on
an incomplete schema. Inspect the actual live backlog and measured migration
cost before deployment: the authorized hosted-dev aggregate is a proxy, while
production is unmeasured. Existing terminal target receipts remain unchanged.
The following concurrent index build must be valid before new binaries run.
The in-flight fill is covered by this manual local rehearsal only; SQLx tests
apply the migration to empty databases. The local rehearsal used 100k links, one million retained terminal targets and
10,129 unfinished targets: the atomic metadata transaction took about 0.12 s
(the fill about 110 ms), changed no relation file, filled all live targets and
left every terminal target unchanged. Target reads/writes waited for that entire
transaction; plain command reads stayed available. Blockers on either parent or
target caused a clean rollback after about five seconds. Both timers are five
seconds, so that rehearsal reported statement timeout rather than lock timeout.
These are synthetic local costs; production backlog and duration remain
unmeasured. The hosted-dev read-only proxy on 2026-11-24 found zero unfinished
targets, which supports the atomic branch but does not establish production size.
If an explicitly authorized deploy-time count instead finds tens of thousands
of unfinished targets, withhold this atomic migration and review a conservative
claim blocker plus bounded post-deploy fill before deployment. That alternate
rollout is not implemented or verified in this branch.

There is no target repair worker, NULL-fact target index or watermark to retire;
`mac-imap-smtp.114` continues to cover only the provider-routing claim lanes.

Parent-ineligible drafts and commands join the shared five-family parked-work
sweep. Actual retry times and live leases survive parking and recovery. Local
target or draft-exclusion deferrals last at most 60 seconds plus the ordinary
poll/service capacity; fenced settlement and a post-commit wake normally clear
them promptly. This ordered SKIP LOCKED wake runs only after settlement
commits; a skipped claim row or process/database failure falls back to that
deadline. The enqueue/finish regression separately checks prompt successor
progress without waiting for that backstop. Commands with more than 64 targets also leave later target wakes to
the deadline. No elapsed deadline permits a claim to bypass an unfinished
overlapping predecessor. Alert on growing parked work or repeated Progress
without acquisition, and inspect closed claim/wake fields rather than provider
messages or mailbox content.

Action chunking rollout (20261123181267–181268): deploy grouped receipt readers
to every replica before an operator enables the backend `enable-mailbox-action-chunks`
flag for service context `email-mailbox-actions`. The flag defaults off and
missing or failed evaluations keep it off; no remote configuration is changed
by this PR. Email-service API and message-label writers share one snapshot;
GraphQL writers poll the same context at 60-second intervals. Agent-harness
(`cognition/server.rs`) and ai_tools (`build_context.rs`) writers remain
default-off legacy writers. They must adopt the shared flag or be retired before
`mac-imap-smtp.116` can remove the wide-command allowance. When on, new actions enqueue disjoint chunks of at most
64 targets atomically with a shared action ID; receipts preserve Pending, then
Cancelled (including unknown), Failed, or Applied precedence. Retire the flag
and legacy enqueue path under `mac-imap-smtp.116` after rollout.

Existing wide commands, rolling old writers and flag-off writes keep their
original accepted orders. The claim evaluates a wide head alone, then leases or
blocks it for 60 seconds rather than repeatedly scanning it in every window.
Hosted dev had no unfinished targets at the authorized aggregate read;
production backlog remains unmeasured.

Chunking is a same-rollout cutover: deploy with the flag off, verify every receipt
reader replica is upgraded, then have the authorized operator turn it on before
that rollout is considered complete. The expected flag-off window is only that
deployment and reader-verification interval, not a multi-day rollout hold; its
wall-clock duration is unmeasured. Do not leave it off after convergence. Missing
or failed remote reads can reopen the off path until it is removed. After the
flip, allow the 60-second refresh cycle and verify every flag-aware writer
replica reports an enabled snapshot before calling that flag rollout complete.
This does not retire the agent-harness/ai_tools legacy writers or their wide
allowance; their migration or removal still blocks `mac-imap-smtp.116`. Track the
flag, off enqueue and wide-command allowance removal together under
`mac-imap-smtp.116`, after no unfinished wide commands remain; retained terminal
NULL-action receipts still need their reader.

Measured flag-off exception (synthetic PG14, not production): a standalone
5,000-target old-format command cost about 25.5k–25.6k buffers with fresh
statistics. The stale mixed-width control peaked at 40,138 buffers, including
5,063 in the window's stale-seed first touch; its repeat used 35,484. These are
measured observations, not a general upper bound. A blocked wide command cost
7.5k–12.3k per evaluation. These costs recur while off-format writers remain;
the 60-second local floor prevents reevaluation in intervening claim windows.
Draft exclusion uses bounded target-key point probes independently of command
width and does not need this wide-command allowance.

The shared claim loop bounds evaluation to 15 seconds and reports a typed
`DeadlineExceeded`; it awaits commit outside that timer to avoid cancelling a
commit after the lease was acquired. Database lock and statement timeouts still
apply. A transport failure at commit can remain ambiguous. Fresh-budget
exhaustion is an error rather than an immediate Progress loop; investigate an
oversized modern command. Unknown intent kinds get a finite 60-second local
floor so a future reader can reconsider the unchanged intent.

Draft exclusion overflow: more than 128 live command leases on one link is beyond
the normal actor count; orphaned leases can temporarily create it. The draft is
conservatively deferred through only `blocked_until` for 60 seconds and reports
`mailbox.exclusion_overflow` plus `mailbox.exclusion_leases_at_least` (a bounded
lower count, not an unbounded COUNT). Retry/lease floors are unchanged. Leases
expire in three minutes; after enough expire, the draft is eligible again. A
scope fitting a fresh budget but not the current remainder waits for the next
claim rather than being deferred.
