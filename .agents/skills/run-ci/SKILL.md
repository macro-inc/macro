---
name: run-ci
description: Run CI on a pull request and wait for its result. Use at a checkpoint (a coherent, locally tested chunk), when you think a PR is done, before asking for review or merging, after fixing a CI failure, and whenever the `CI gate` status says CI has not run.
---

# Run CI on a pull request

## When to run CI

Run CI deliberately, after the local checks for what you changed pass
(`just check`, the affected tests):

- at a checkpoint: a coherent, locally tested chunk you want real CI on before
  building further;
- when you think the PR is done, and before asking for review or merging;
- after pushing the fix for a CI failure.

Not after every small push, not while you are still iterating, and never
instead of local checks: every run costs CI compute.

## How it works

CI runs when someone asks for it, not on every push. Adding the `run-ci` label
to a PR runs every check on its head commit (the `PR CI` workflow), and the
label disappears as the run starts. The result is the `CI gate` commit status on
that commit. `main` requires `CI gate` to pass on the PR's latest commit, so
every push needs a new run before the PR can merge.

## Run it

Push first, then ask for the run:

```sh
gh pr create --title "..." --body-file body.md --label run-ci         # a new PR
gh api repos/macro-inc/macro/issues/<pr>/labels -f "labels[]=run-ci"  # after a push
```

`gh pr edit <pr> --add-label run-ci` does the same on a recent gh; older
releases fail on a Projects (classic) error before adding the label.

If `run-ci` is still present, remove it before adding it again so GitHub receives
another label event:

```sh
gh api -X DELETE repos/macro-inc/macro/issues/<pr>/labels/run-ci
gh api repos/macro-inc/macro/issues/<pr>/labels -f "labels[]=run-ci"
```

- Adding the label again starts a fresh run. A run still going for the same PR
  is cancelled.
- Draft PRs run too.
- Only PRs into `main` run. A stacked PR, based on another branch, gets no
  `CI gate` and the label does nothing until its base is `main`. To run
  one, set its base to `main`
  (`gh api -X PATCH repos/macro-inc/macro/pulls/<pr> -f base=main`), wait
  until `gh pr view <pr> --json baseRefName,mergeable` says `main` and
  `MERGEABLE`, take the label off and add it again, and set the base back
  when `CI gate` has its result. The run tests the PR merged with `main`,
  so what `main` has gained since the stack last merged it is part of what
  runs. While its base is `main` the PR's diff holds its parents' commits:
  it is not to be merged then.
- Other labels never start or cancel CI.
- The email end-to-end suites are not in `PR CI`. For a PR that changes
  email, calendar or those suites, also run them on the branch by hand:
  `gh workflow run email_e2e_browser.yml --ref <branch>` and
  `gh workflow run email_e2e.yml --ref <branch>`, then read the runs with
  `gh run list --workflow email_e2e_browser.yml --branch <branch>`
  (`apps/web/tests/email-e2e/README.md`, CI).
- A label added within seconds of a push can reach GitHub before the push
  does. `Start` then fails within seconds and `CI gate` says to add the label
  again. To avoid it, add the label once `gh pr view <pr> --json headRefOid`
  shows the commit you pushed.

## Wait for it

Use the `babysit-pr` skill's watcher: `pr-wait <pr> --until green`. It exits 1
with the command to run when CI has not run on the head, and exits 1 when
`CI gate` fails. Never poll with your own loop.

To read the state once, look at the `CI gate` row of `gh pr checks <pr>`:

| `CI gate` | Meaning | Do |
| --- | --- | --- |
| pending, `Not run on this commit. Run: ...` | No run on this head | Add the label |
| pending, `Running on <sha>` | A run is going | Wait |
| pass, `Passed on <sha>` | Every check passed or was path-skipped | Done |
| fail, `Failed: <jobs>` | Those called workflows failed | Open the linked run, fix, push, run again |
| fail, `The PR moved on ...` or `The merge commit did not include ...` | Labelled too soon after a push | Add the label again |
| fail, `PR CI can't start: ...` | The PR conflicts with `main`, or was last pushed before `PR CI` existed | Merge `main` in, push, add the label again |
| missing | A fork PR before its first run, or a PR that conflicts with `main` (a push then runs only `pull_request_target` checks such as CLA: no PR Privacy Check or Auto Label) | A maintainer adds the label; or merge `main` in, push, then add the label again (re-adding it without the merge does nothing) |

GitHub takes `PR CI` from the PR's merge commit with `main`, which it rebuilds
on a push but not when `main` moves, and runs nothing on a conflicting PR. So on
such a PR the label alone starts nothing; `CI Gate Label Check` then removes it
and says why in `CI gate`.

## Review every result and fix failures

After every CI run, inspect the results yourself:

```sh
gh pr checks <pr>
gh run view <run-id> --log-failed
```

1. Read the logs for every failed job, not only the `CI gate` summary.
2. If the branch caused a failure, fix it, run the affected local checks, commit,
   and push the fix.
3. If evidence shows an unrelated failure, record the job, error, and evidence in
   the PR body and `PROGRESS.md`. Check for broken `main` or a flaky test outside
   the changed code. Request one unchanged retry through step 4 to test recurrence.
4. Verify the remote PR head, then request another run with `run-ci`.
   If the label is still present, remove it before adding it again, as shown above.
5. If the unchanged retry fails again, document the persistent blocker and investigate;
   do not repeatedly rerun unchanged code.
6. Repeat the fix-and-rerun cycle until `CI gate` passes on the latest commit.
   If later CI fails, repeat this procedure without waiting for the user.

A passing retry without relevant changes supports a flaky-failure diagnosis;
a repeated unrelated failure remains a blocker, not a passing check.
The checks inside the run are named `<workflow> / <job>`, such as
`Web App / Typecheck` or `Cloud Storage / test`.

## Fork PRs

A maintainer adds the label after reading the diff: the run executes the
fork's code. The fork's token can't set statuses, so `CI Gate for Forks`
removes the label and sets `CI gate` to `Running on <sha>` on the head the
label went on, then copies the verdict of the `pr-ci.yml` run onto that head.
Re-running a fork's failed jobs doesn't update `CI gate`; add the label again.

A fork run uses the fork's workflow files, so a fork that changes `.github/` or
`tooling/xtask/crates/xtask_workflows` gets `CI gate` failure (`fork changes CI
workflows`). To test it, a maintainer reviews it, pushes it to a branch here,
and runs CI on a PR from that branch.
