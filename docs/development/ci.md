# CI on pull requests

CI runs on a pull request only when someone adds the `run-ci` label. The `PR CI`
workflow then runs every check on the PR's head commit, removes the label, and
reports the result as the `CI gate` commit status on that commit. Each push
leaves the new commit at `Not run on this commit`, so a PR can merge only after
a passing run on its latest commit.

Run CI deliberately: at a checkpoint, a coherent locally tested chunk you want
real CI on before building further, or when you think the PR is done. Never
after every push, and never instead of local checks.

If the label starts nothing and `CI gate` says `PR CI can't start`, the PR
conflicts with `main` or was last pushed before `PR CI` existed: merge `main`
in, push, and add the label again.

The [`run-ci` skill](../../.agents/skills/run-ci/SKILL.md) has the commands,
what each `CI gate` state means, re-runs, and fork PRs. The workflows are
generated from Rust; see the
[workflows rule](../../.agents/rules/infra/github-workflows.md).

## Email end-to-end suites

`PR CI` does not run the email end-to-end suites, and `CI gate` does not
wait for them. The Rust scenarios (`email_e2e.yml`) and the browser suite
(`email_e2e_browser.yml`) run on pushes to `main`. A daily sweep at 21:00 UTC
(4pm EST, 5pm EDT) runs them with their tests kept for known bugs, and runs
the full-stack tier (`email_e2e_full_stack.yml`). Before merging a pull
request that changes email, calendar or the suites, run them on its branch
by hand: `gh workflow run email_e2e_browser.yml --ref <branch>` and `gh
workflow run email_e2e.yml --ref <branch>` (`-f known_bugs=true` adds the
known bugs). The [suite's README](../../apps/web/tests/email-e2e/README.md)
has the trigger table and the other commands.

## RustSec advisories

`cargo deny` reads the live RustSec advisory database. On a PR it fails only
on advisories against packages the PR adds to `Cargo.lock`: a name and
version the base's lockfile doesn't have. An advisory published against a
package already on `main` doesn't fail PRs. The daily `cargo deny advisories`
workflow fails on it instead, and a failed run posts to the Macro Alerts
channel. The CI owner fixes it on `main`: update the crate, or ignore the
advisory in `deny.toml` with a reason.

Locally, `cargo deny check advisories` reports every advisory, as the daily
run does.
