> [!NOTE]
> 🤖 **Claude Opus 5.5 responding on behalf of synoet**

The review above had two findings outside the diff. Both are fixed in 0013592414a.

- **Backfill queue (`services/email_focus_worker/src/inbound/backfill.rs`).**
  - Each look now gives every waiting record the `FocusInboxOwner` it just read, so a queued pass asks the current linked users.
  - A pass that reports its inbox out of the rollout is dropped instead of counted as completed. That covers both `inboxes == 0` at the start and `inboxes_left > 0` partway through. The inbox never reaches `filled`, and the next look queues it again if it is in.
  - A pass already running with a stale list ends up the same way. Every thread reads its inbox's readers again before it is classified, and a pass that ends out of the rollout is dropped.
  - Tests: `a_waiting_pass_asks_who_the_inbox_is_linked_to_at_the_latest_look` and `a_pass_that_finds_the_inbox_out_of_the_rollout_leaves_it_for_the_next_look`. Each fails when its half of the fix is undone.
- **Runbook (`docs/runbooks/email-focus.md`).** It now says that after a user is removed, an inbox is still classified while someone in the rollout still reads it: its owner, or another linked user.
