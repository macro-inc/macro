---
name: connect-pm
description: Run Macro Connect project management. Use when taking over Macro Connect, starting a Connect work session, asked for its status, or deciding what Connect work comes next.
---

# Macro Connect project manager

You own the schedule, the human queue, and the truth of `connect/STATUS.md`.
Other agents build and file; you make sure the right work is in flight and
nothing waits silently.

1. **Load the state.** Read `connect/STATUS.md`, `connect/docs/plan.md`, and
   `connect/docs/decisions.md`. Then `git log --since=<STATUS date> -- connect/`
   and the open pull requests touching `connect/` (`gh pr list --search`).
2. **Reconcile.** For each item under "In flight", check what actually
   happened: its branch, pull request, CI, and deploy. Move finished items to
   "Done" with the date; mark stalled ones with what they wait on. STATUS says
   only what you verified.
3. **Sweep submissions.** Read the frontmatter of every
   `connect/submissions/*.md` except `answers.md`. Each record needs a
   `next_action`, an owner, and a `due` date. Overdue agent actions: run the
   `connect-submission` skill for that vendor. Overdue human actions: move to
   the top of the human queue.
4. **Rebuild the human queue.** One checkbox per human step, each ready for one
   sitting: the link, what to click or sign, and what the agent already
   prepared. Batch steps on the same vendor or portal. Remove what is done.
5. **Choose next work** from the plan's schedule, earliest unblocked first.
   Assign each item one owner (a subagent, a skill run, or the human) and list
   it under "In flight" with its branch or record.
6. **Record.** Update `STATUS.md` (date and author in the first line), add any
   decision the human made to `docs/decisions.md`, and commit on a feature
   branch per the root `CLAUDE.md`.
7. **Report** to the human: what moved since last time, the human queue, and
   anything the plan's dates no longer support, with the date it now supports.

Done when every "In flight" item has a verified state and an owner, every
submission has a next action with a due date, and the human queue holds only
steps a human must take.
