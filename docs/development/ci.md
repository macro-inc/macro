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
