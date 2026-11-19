# email-focus-linked (worker, project email-focus, started 2026-11-19)

PR 5 of the Email Focus rollout: a linked inbox follows its primary user's flag.
Brief: the user's "Yes can we add that please" (2026-11-19), relayed by `email-focus`.

## Rule built

An inbox is in the rollout when anyone whose Focus tab shows it has the flag: its owner
(`email_links.macro_id`) or a user it is linked to (`macro_user_links.primary_macro_id`
for that `link_id`). Departure from the brief ("the primary for a linked inbox"): the
owner still counts, because an edge's child is the address's own Macro account (Gmail
`bootstrap`/`delegate`, Outlook `Delegate`/`Rehome`) or a minted shared-mailbox user
with two primaries; dropping the owner would turn off a real account's own Focus.

## Plan

1. `FocusInbox` / `FocusInboxOwner` gain `delegates`; `thread_inbox`, `inboxes_with_focus`,
   `syncing_inboxes` read them (one `macro_user_links_link_idx` probe per inbox).
2. `FocusService::is_enrolled` asks owner, then delegates; yes wins, unknown only when
   nobody says yes and a read failed.
3. Tests: service fakes, focus_pg DB tests, worker test with PostHog local eval + DB,
   email_e2e scenario (ada on, bob off, ada links bob's mailbox).
4. EXPLAIN on a private nix Postgres (target/), docs (crates/email/AGENTS.md, runbook).

## Status

- Branch synoet/email-focus-linked reset to origin/main e22fa6483f5 (it held another
  branch's routines commits, all on origin/synoet/routine-catalog-additions).
- 2026-11-19: built and opened as https://github.com/macro-inc/macro/pull/11501 (ready for
  review), head d14e84d2f6d (f60c93d7a20 feature, 24240332806 e2e scenario, d14e84d2f6d
  coverage rows). Not merged; merge only when told.
- Proof: https://claude.ai/artifact/Ec2XEyQSkq63Sft1xqpoJm and
  https://solaris.tail913c08.ts.net:28749/proofs/email-focus/linked-inbox/ ; code tour
  https://solaris.tail913c08.ts.net:3433/r/ev648xezep
- Tests on 24240332806: email 1795 passed; email_focus_worker 38 passed, 1 ignored;
  email_e2e focus 6/6, new scenario stress 20/20. Before (main's worker) and owner-only
  mutant both fail the scenario at the 120 s timeout; branch passes in 14 s.
- Plans (PG 14.23, 150k syncing mailboxes): thread_inbox 0.01-0.11 ms, inboxes_with_focus
  13-18 ms, syncing_inboxes 190-315 ms (main ~25 ms), justified `fix` in the PR body.
- CI: run-ci label added on d14e84d2f6d (PR CI 44599802434); email_e2e 44599800073 and
  email_e2e_browser 44599805090 dispatched on the branch.
- Cleaned up: private PG, the three e2e containers, target/{before-*,e2e-*,clippy,focus-linked-pg}.
- 2026-11-19 later: b8bc8201563 (docs) got `CI gate` green (PR CI 44601477047); e2e
  44599800073 / 44599805090 on d14e84d2f6d both succeeded.
- CodeRabbit review: 2 real findings fixed in 0013592414a (sweep no longer settles a
  NotEnabled thread, counts `SweepReport::inboxes_left`; backfill queue takes each look's
  delegates and drops a pass that found the inbox out of the rollout instead of filling
  it), plus the runbook note. Replies: https://github.com/macro-inc/macro/pull/11501#discussion_r4634507264
  and https://github.com/macro-inc/macro/pull/11501#issuecomment-7021024233. PR title
  shortened to "feat(email-focus): a linked inbox follows its primary user's flag"; body updated.
- Tests on 0013592414a: email --lib 1793/1796 (3 log-capture tests in untouched files race
  under threads, pass alone), all 138 focus tests; email_focus_worker 40 passed, 1 ignored;
  each new test fails with its fix undone; just check and clippy -Dwarnings clean.
- CI on 0013592414a: run-ci added, PR CI 44606615961, e2e 44606613611 and browser
  44606617484 dispatched; still running when the user moved off solaris.
- Stopped for the move off solaris: PR branch pushed at 0013592414a; proof material
  (scratchpad) pushed to synoet/email-focus-linked-wip under proof-wip/. The tailnet page
  and the diffd tour live on solaris and go with it; the Artifact holds the proof.
- Left: `CI gate` green on 0013592414a, then merge on approval.
