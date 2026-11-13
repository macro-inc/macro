//! `Advisory DB Bump` — daily, moves the RustSec advisory database pin that
//! [`super::cargo_deny`] reads to the latest advisory-db commit. Generated into
//! `advisory_db_bump.yml`.
//!
//! The bump goes in one open PR from [`BRANCH`]: a run opens it, or adds a
//! commit to it while it is open. Before that, the run checks the new pin
//! with cargo-deny and writes the result into the description, so a newly
//! published advisory against a crate in `Cargo.lock` fails this PR only.
//! Its owner pushes the fix or ignore to the branch and merges.
//!
//! The PR is opened with the Actions token, whose events start no workflow:
//! CI waits for someone to add the `run-ci` label, like on any PR. The CLA
//! workflow doesn't run on its pushes either, so the run sets the required
//! `cla` status itself, as [`super::cla`] does for a bot's PR.

use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, Run, Schedule, Step, Workflow,
    WorkflowDispatch,
};

use crate::workflows::{cargo_deny, runners, steps};

#[cfg(test)]
mod test;

/// The branch the bump PR comes from.
pub const BRANCH: &str = "ci/advisory-db-bump";

const CHANGED: &str = "steps.prepare.outputs.changed == 'true'";

/// Build the workflow.
pub fn advisory_db_bump() -> Workflow {
    Workflow::new("Advisory DB Bump")
        .on(Event::default()
            .add_schedule(Schedule::new("17 6 * * *"))
            .workflow_dispatch(WorkflowDispatch::default()))
        // Two runs at once would both push to the branch.
        .concurrency(Concurrency::new(Expression::new("advisory-db-bump")))
        .add_job("bump", bump_job())
}

/// Small, like the cargo-deny job: the deny action needs Docker.
fn bump_job() -> Job {
    Job::default()
        .name("Move the advisory database pin")
        .runs_on(runners::Runner::Small.to_string())
        .timeout_minutes(15u32)
        .permissions(
            Permissions::default()
                .contents(Level::Write)
                .pull_requests(Level::Write)
                .statuses(Level::Write),
        )
        .add_env(("GH_TOKEN", "${{ github.token }}"))
        .add_env(("BUMP_BRANCH", BRANCH))
        .add_env(("BUMP_BASE", "main"))
        .add_env(("REV_FILE", cargo_deny::ADVISORY_DB_REV.as_str()))
        // The script pushes with the token checkout leaves in git config.
        .add_step(steps::checkout(false, true))
        .add_step(script("Pick the latest advisory database", "prepare").id("prepare"))
        .add_step(cargo_deny::fetch_advisory_db().if_condition(changed()))
        .add_step(
            cargo_deny::deny("--disable-fetch advisories")
                .id("deny")
                .if_condition(changed())
                // A failure is the PR's news, not this run's.
                .continue_on_error(true),
        )
        .add_step(
            script("Open or update the bump PR", "publish")
                .if_condition(changed())
                .add_env(("PIN_FROM", "${{ steps.prepare.outputs.from }}"))
                .add_env(("PIN_TO", "${{ steps.prepare.outputs.to }}"))
                .add_env(("PR_NUMBER", "${{ steps.prepare.outputs.pr }}"))
                .add_env(("DENY_OUTCOME", "${{ steps.deny.outcome }}"))
                .add_env((
                    "RUN_URL",
                    "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}",
                )),
        )
}

fn changed() -> Expression {
    Expression::new(CHANGED)
}

/// A step running `scripts/advisory_db_bump.ts` in one of its modes.
fn script(name: &str, mode: &str) -> Step<Run> {
    Step::new(name)
        .run(steps::node_script(include_str!(
            "scripts/advisory_db_bump.ts"
        )))
        .shell("bash")
        .add_env(("BUMP_MODE", mode))
}
