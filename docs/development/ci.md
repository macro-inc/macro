# CI on pull requests

CI runs on a pull request only when someone adds the `run-ci` label. The `PR CI`
workflow then runs every check on the PR's head commit, removes the label, and
reports the result as the `CI gate` commit status on that commit. Each push
leaves the new commit at `Not run on this commit`, so a PR can merge only after
a passing run on its latest commit.

Run CI deliberately: at a checkpoint, a coherent locally tested chunk you want
real CI on before building further, or when you think the PR is done. Never
after every push, and never instead of local checks.

The [`run-ci` skill](../../.agents/skills/run-ci/SKILL.md) has the commands,
what each `CI gate` state means, re-runs, and fork PRs. The workflows are
generated from Rust; see the
[workflows rule](../../.agents/rules/infra/github-workflows.md).
