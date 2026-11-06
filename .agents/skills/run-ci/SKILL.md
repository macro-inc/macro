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

- Adding the label again starts a fresh run. A run still going for the same PR
  is cancelled.
- Draft PRs run too.
- Other labels never start or cancel CI.
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
| missing | A fork PR, before its first run | A maintainer adds the label |

## Fix a failure

- A flaky job: re-run the failed jobs of the `PR CI` run
  (`gh run rerun <run-id> --failed`). `CI gate` re-runs with them and updates
  the status; no new label is needed.
- A real failure: fix it, push, and add the label again.
- The checks inside the run are named `<workflow> / <job>`, such as
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
