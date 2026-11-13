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

The `cargo deny` check reads the RustSec advisory database at the commit in
`.github/advisory-db-rev`, not the live one, so a newly published advisory
can't fail every PR that touches Cargo files. Each day the `Advisory DB Bump`
workflow moves the pin to the latest commit, in one PR from the
`ci/advisory-db-bump` branch, and writes into its description whether
cargo-deny passes on the new pin. Whoever owns CI health owns that PR: if it
fails, push the fix (update the crate, or ignore the advisory in `deny.toml`
with a reason) to that branch, add `run-ci`, and merge. Its later runs add
commits on top of yours.

To check the pinned database locally from the repository root, run the
commands of the `Fetch the pinned advisory database` step in
`.github/workflows/cargo_deny.yml`, then `cargo deny check --disable-fetch`.
A plain `cargo deny check` moves that clone to the latest database, which is
what the next bump will see.
