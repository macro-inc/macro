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

Each workflow's pushes to `main` queue as the dev deploys do: one run at a
time, never cancelled, and of the pushes that come meanwhile only the newest
waits; a newer push replaces (cancels) the one waiting. A replaced commit is
not run on its own: the next run tests the newer tree, which holds its
changes, so the commit is covered, and a failure points to the commits since
the last pass rather than to one commit. A push the path filters skip starts
no run, and the next run covers it the same way. The sweep queues apart, so a
push never replaces it. A run by hand and a re-run neither wait for nor
replace another run: a re-run in the queue would replace the push waiting
and test an older commit in its place (`concurrency` in `xtask_workflows`'
`email_e2e.rs`).

The channels suite (`channels_e2e.yml`,
[its README](../../apps/web/tests/channels-e2e/README.md#in-ci)) runs the same
way: on pushes to `main`, queued as above, and nightly at 04:00 UTC; not in
`PR CI`. On a branch, `gh workflow run channels_e2e.yml --ref <branch>`. Its
last job is the same `Tell Macro Alerts` job, so what follows holds for it
too, with the nightly run in place of the sweep.

### When an email end-to-end alert fires

The last job of each of the three workflows, `Tell Macro Alerts`
(`xtask_workflows`' `email_e2e_alert.rs`), posts to the Macro Alerts channel
through the webhook the `cargo deny advisories` run uses. It posts for pushes
to `main` and for the sweep, never for a run by hand, and only when a run's
result differs from what the channel was last told: a red run posts the
failure when the channel shows the workflow passing, and a green run posts
`✅ Resolved` when it shows it failing. Pushes and the sweep are counted
apart, since only the sweep runs the tests kept for known bugs. The job's last
step records what the channel then shows, and the next run's job reads it; a
workflow's alert jobs run one at a time. A red run while the channel already
shows it failing, a run cancelled by hand, and a run that ends after a newer
run has ended post nothing; the job's summary says why. In the last case the
newer run's alert job tells the channel, or, if that job never runs (its run
was cancelled), the next run does. A push replaced while it waited starts no
job, so it posts nothing either: the next run that ends posts in its place,
and its failure names the last pass before it, so the changes since span its
commit. A run is red when one of its jobs failed or ran out of time; GitHub
lists a run with a job that ran out of time as cancelled, but its alert job
runs. A failed post records nothing, so the next run posts it again, as does
re-running the alert job while no newer run has ended. A re-run of a
flaky failure that passes posts that it passes again only while no newer run
has ended; otherwise the newer run's result stands.

The alert names the commit and its pull request, the failed jobs with the
step each failed at, the failed tests the coverage report names, the tests
kept for a known bug that now pass, and the commit the workflow last passed
at with the changes since. When the workflow last passed at the commit just
before, the author of the pull request it names looks first; otherwise, as
after replaced pushes and for the sweep, start from the changes since the
last pass.

1. Open the run. The summary of its coverage job lists what failed, and the
   coverage report is an artifact of the run: `email-e2e-coverage`,
   `email-e2e-browser-coverage` or `email-e2e-full-stack-coverage`. A failed
   job keeps its service logs (`email-e2e-logs-<part>`,
   `email-e2e-browser-logs-<shard>`, `email-e2e-full-stack-logs`) and the
   browser suite its Playwright traces (`email-e2e-browser-traces-<shard>`,
   `email-e2e-full-stack-traces`).
   The channels suite has two jobs (the app without and with channel local
   sync; the second adds `-local-sync-on` to its artifact names) and no
   coverage job: each summary has the
   ledger check, its report is `channels-e2e-report`, and a failed run keeps
   `channels-e2e-stack-logs` and `channels-e2e-results` (the traces).
2. Run the test locally: `just email-e2e <scenario>` for a Rust scenario,
   `just email-e2e-browser <test>` for a browser test, and the
   [full-stack tier's commands](../../apps/web/tests/email-e2e/README.md#the-full-stack-tier)
   for a `full-stack-*` test.
   For a channels test, start and seed a stack and run
   `just test-channels-e2e <instance> -g <test id>` from `apps/web`
   ([README](../../apps/web/tests/channels-e2e/README.md)).
3. A change broke it: fix or revert the change. It fails for a product bug
   that will not be fixed now: keep the test, asserting the right behaviour,
   and mark it as a known bug, so it stops gating. A Rust scenario gets
   `#[ignore = "known bug: <class id>"]`
   ([`crates/email_e2e/AGENTS.md`](../../crates/email_e2e/AGENTS.md)); a
   browser test gets `{ tag: '@known-bug' }` and a line in
   `ledger/waivers.tsv`
   ([README](../../apps/web/tests/email-e2e/README.md)). A bug that shows
   only in some runs is also tagged `@sometimes` (browser) or named under
   `[[intermittent_bug]]` in `crates/email_e2e/coverage/waivers.toml` (Rust).
   A channels test is marked `knownDefect()` with a row in
   `ledger/known-defects.tsv`, or wraps the check in `failsSometimes` with a
   row in `ledger/intermittent-defects.tsv`.
4. Kept for a known bug and now passing: the bug is fixed, and the alert
   comes from the known-bug report, not from a gating test. Remove the
   `#[ignore]` and the `bug` line of its function in
   `crates/email_e2e/coverage/functions.toml`, or the `@known-bug` tag and
   its waiver line, so the test gates again.
   The channels suite runs its known-defect tests in every run, so one that
   passes fails the run and is named with the failed tests as "marked as a
   known defect, and now passes": remove its `knownDefect()` and its row in
   `ledger/known-defects.tsv`.
5. "This commit passed in an earlier run" means the failure may be flaky:
   re-run the failed jobs, and treat a test that passes only on a retry as a
   defect of the test or the product.

Run the fix on its branch by hand, as above, before merging it. The next push
or sweep that passes posts `✅ Resolved`.

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
