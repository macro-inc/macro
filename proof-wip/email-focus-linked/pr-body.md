## Why

Focus only ran for a user's own inbox. A mailbox they linked was classified
only if that mailbox's own account was on the rollout flag too, so its mail
never reached their Focus tab.

Email Focus is rolled out per user with the `enable-email-focus` flag, but the
worker asked only the flag of the inbox's owner (`email_links.macro_id`). When
someone links a mailbox whose address has its own Macro account (a colleague's
or a shared mailbox), the link stays owned by that account and the person who
linked it reaches it through `macro_user_links`. Their Focus tab lists the
inbox as one of theirs, but it was never classified unless the address itself
was on the flag. So Focus covered only a user's own inbox.

## How it works

An inbox is in the rollout while anyone whose Focus tab shows it has the flag:
its owner, or a user it is linked to (`macro_user_links.primary_macro_id` for
its `link_id`).

```
            thread / inbox
                  │
   owner ──flag?──┤ yes ─────────────► classify
                  │ no / unknown
   linked users ──┤ any yes ─────────► classify
   (primary_macro_id, sorted, once)
                  │ none yes
                  ├ a read failed ──► unknown (fail closed, retried)
                  └ all no ─────────► not enabled (as before)
```

- The owner is asked first, so an account's own inbox keeps following its own
  flag and costs one check, as before. Linked users are asked only when the
  owner is out.
- The owner still counts. A `macro_user_links` edge exists only when the
  address has a Macro account of its own (or is a shared mailbox's own user),
  so dropping the owner would turn off that account's own Focus.
- **A linked inbox whose primary user is not on the flag is not classified,
  unless its own owner or another user it is linked to has the flag.** Taking a
  primary user off the flag stops every inbox that only they kept in.
- The same check runs on every path: live Kafka events, the hourly sweep, the
  every-minute look that finds newly enrolled inboxes, and backfill. A primary
  user who gets the flag has their linked inboxes found and backfilled within a
  look; one who loses it stops them within the flag's five-minute refresh.
- Who reads an inbox can change while the worker holds an old list of them
  (an unlink, then a re-link). Every thread still reads its inbox's readers
  again before it is classified. A thread found out of the rollout that way is
  never remembered as checked, and the pass stops walking that inbox. A
  backfill pass that finds its inbox out isn't counted as filled, and a queued
  pass takes the readers of the latest look. So after a re-link the next
  sweep or backfill classifies those threads instead of skipping them until
  new mail arrives.

Reads (`focus_thread_ids`, `focus_for_threads`) and the gateway push already
covered linked inboxes; only enrollment changes.

## What

- `FocusInbox` and `FocusInboxOwner` (`crates/email/src/domain/focus/models.rs`)
  carry `delegates`: the users other than the owner the inbox is linked to.
- `FocusService::is_enrolled` (`service.rs`) asks the owner, then each
  delegate; the first yes settles it, and an error makes the answer unknown
  only when nobody said yes. The sweep prefers the linked users it just read
  over the ones it remembered from the last look. `sweep_inbox` never settles
  a `NotEnabled` thread and counts such an inbox in
  `SweepReport::inboxes_left` (logged by the sweep and the backfill).
- The worker's backfill queue (`inbound/backfill.rs`) gives every waiting
  inbox the linked users of each look, and drops a pass that found its inbox
  out of the rollout, at the start or partway, rather than marking it filled.
- `focus_pg.rs`: `thread_inbox`, `inboxes_with_focus` and `syncing_inboxes`
  read the delegates with one `macro_user_links_link_idx` probe per inbox,
  leaving out edges whose primary is the owner itself. Rust sorts and
  deduplicates them (a user can reach an inbox through more than one account)
  and drops a malformed id with a warning rather than failing a read of many
  inboxes.
- `FlagEnrollment` (`services/email_focus_worker`) is unchanged in behaviour;
  its docs now say it answers for a user, not an owner.
- Tests: service fakes for join, leave, unlink, backfill after joining, an
  unreadable owner with an enrolled linked user, an unknown result, and a
  thread found out of the rollout and classified once its inbox is re-linked;
  worker queue tests for a waiting pass taking the latest look's linked users
  and for a pass that finds its inbox out leaving it unfilled;
  `focus_pg` DB tests for each read naming the linked users (one mailbox read
  by several users, an edge back to the owner); a worker test with PostHog
  local evaluation and a real database, flag on for the linked user and off
  for everyone; an `email_e2e` scenario where a user with the flag links a
  colleague's mailbox without it and gets Focus, and a pair both without the
  flag gets none.
- Docs: `crates/email/AGENTS.md`, `crates/email_e2e/AGENTS.md`,
  `docs/runbooks/email-focus.md`, `docs/agent-guide/email.md` (it still said
  a delegated inbox follows its owner's flag), and the doc comments of the
  worker and the e2e harness.

## Database review

Measured with `EXPLAIN (ANALYZE, BUFFERS)` on PostgreSQL 14.23 (production
runs 14.22), the exact SQL from `.sqlx`, `random_page_cost = 1.1`,
`work_mem = 16MB`, JIT off, custom and generic plans, first and repeated runs,
with fresh statistics and with statistics taken before the bulk of the seed.
Seed: `email_links` 200,000 (150,000 syncing), `macro_user_links` 160,500 (half
the mailboxes linked to one user, a quarter to a second, one mailbox read by
500 users, 10,000 edges back to the owner), `email_threads` 2,050,000,
`email_thread_focus` 70,000 (2,500 inboxes holding Focus).

| Severity | Query | Fired by | Rows touched at size | Index or bound | Evidence | Finding |
| --- | --- | --- | --- | --- | --- | --- |
| fix (justified) | `syncing_inboxes` (`focus_pg.rs`) | the worker's look, once a minute, one replica, one look at a time (`MissedTickBehavior::Delay`) | every syncing mailbox (the read was already whole by design), plus that mailbox's edges | `email_links` read whole as before; per mailbox an Index Scan on `macro_user_links_link_idx` | measured: 190–315 ms, ~511k shared hits, 150,000 loops, every run; main's read without the delegates: ~25 ms | Linear in connected mailboxes, read-only, no locks, no retries that stack. A hash join of all edges (100–175 ms) and a pre-aggregated join (170–195 ms) were no cheaper once the edges are read; a `GROUP BY` form spilled 9 MB under stale statistics. Kept the probe; revisit if connected mailboxes grow far past the seed |
| note | `inboxes_with_focus` (`focus_pg.rs`) | the hourly sweep | one row per inbox holding Focus (2,500) plus their edges | recursive skip scan over `email_thread_focus` as before; delegates by `macro_user_links_link_idx` | measured: 13–18 ms, 23–26k shared hits, same plan in every run | Bounded by inboxes holding Focus |
| note | `thread_inbox` (`focus_pg.rs`) | each mail event the worker classifies | one thread, one mailbox, that mailbox's edges | primary keys of `email_threads` and `email_links`; `macro_user_links_link_idx` | measured: 0.01–0.11 ms repeated, 15–22 buffers, 500 edges read with 10 buffers for the 500-reader mailbox, same plan in every run | Bounded by one mailbox's readers |

No statement timeout added: none of the three depends on one tenant's data,
the two whole-set reads run from single background loops that wait for each
other, and `thread_inbox` is key lookups.

## Follow-ups

- Classification is still profiled and metered against the inbox's owner, not
  the linked user whose flag enrolled it.
- The gateway notifier reads the same edges again for every push; it could take
  the delegates the service already has.

Created with Claude Opus 5.5 in Claude Code.
