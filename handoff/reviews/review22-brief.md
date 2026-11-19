Review, don't change: run the repository's `review` skill (`.agents/skills/review/SKILL.md`) on
the commits below, as the reviewer that did not write them. Make no commits and no edits in any
checkout. Write no Python, not even a one-off; use shell, jq, Rust or TypeScript. Don't start,
stop or touch any stack, container, database or browser, and don't deploy. Commands need
`nix develop <worktree>` (bun only works inside it).

These are the commits since the last review (`~/.cache/routines-draft-subroutines/review21-report.md`):
answers to its findings, and merges up the stack. Three stacked branches, bottom up:

1. Scheduler: `~/.herdr/worktrees/macro/synoet-routines-sub-routine-definitions`,
   branch `synoet/routines-sub-routine-definitions`, range `a1ef9cf9838..c6aa89bf71c`:
   - `2817be43971`: docs for the outcomes of a parent switched off or on.
   - `49883c356a7`: each knob in `GET /scheduled-actions/{id}/unusable-items` names the
     sub-routine holding it (`sub_routine`, absent for the routine's own steps), since step ids
     are unique only among the steps they run with; regenerated web client and OpenAPI.
   - `2c682dccde6`: a copy's step whose picked item is gone tells its owner to pick another in
     its parent routine's sub-routine, not in the copy's own (read-only) settings.
   - `c6aa89bf71c`: a test for the `partial` outcome of a parent's sub-routines following it.
2. Drafter and SDK: `~/.herdr/worktrees/macro/synoet-routines-draft-sub-routine-definitions`,
   branch `synoet/routines-draft-sub-routine-definitions`, range `bc715aa07f6..3fe6bb8960f`:
   - `70475c6f37b`, `3fe6bb8960f`: merges of the scheduler branch.
   - `400eb060aef`: the sub-routine brief (`finding/later.md`) says a sub-routine's steps can't
     use apps and work that needs one is the routine's own Ask AI step's. The answer to the
     previous review's apps finding; judge whether the prompt now leaves the drafter a clear
     path, and whether anything in `drafts/apps.md` (main's text) still contradicts it.
3. Web editor: `~/.herdr/worktrees/macro/synoet-routines-sub-routine-editor`,
   branch `synoet/routines-sub-routine-editor`, range `8c339cf7ece..9e1688f66d4`:
   - `998bb364eaf`, `9e1688f66d4`: merges of the drafter branch.
   - `2561c41b4e1`: knobs needing a new pick are placed by sub-routine and step id: a
     definition's editor marks its own, and the routine's own steps get only theirs.
   - `32f18f798f5`: the page reads unusable items when only a sub-routine picks an item.

What to look for: whether each fix does what its commit says, whether each new test can fail
without its fix (run the routines web tests with vitest from `apps/web`, the Rust tests with
`cargo test -p scheduled_action`, swapping code only in detached copies outside the checkouts),
lost behaviour in the merges, stale docs and guides (grep the changed names). Use the review
skill's table to decide whether a database review applies; as far as I know none of these
ranges adds or changes a query of its own, so confirm that from the diffs rather than taking it
from me. The previous review's query finding (widened callers of main's entity-access checks)
is answered by a row in the scheduler PR's body at
`~/.cache/routines-draft-subroutines/pr1/pr-body.md` (section `## Database review`, row
"Picked items"); check the bound it states against `crates/routine_program/src/validate.rs`.

Return one findings table per branch with severity (`block`, `fix`, `note`), file and line, and
the shortest excerpt that shows each finding. Write it to
`~/.cache/routines-draft-subroutines/review22-report.md` as well.
