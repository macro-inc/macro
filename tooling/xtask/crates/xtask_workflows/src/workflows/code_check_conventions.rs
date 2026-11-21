//! `conventions code check` — repo convention lints, generated into
//! `code_check_conventions.yml`. `PR CI` calls it only when [`PATHS`] changed,
//! and `CI gate` reads the call's result, so it has no path-check or roll-up
//! job of its own.
//!
//! Runs `ast-grep scan` over the custom structural rules in `rules/ast-grep`
//! (config: `sgconfig.yml` at the repo root). The scan fails only on
//! `severity: error` findings; `warning`/`hint` rules surface through
//! CodeRabbit's ast-grep integration on changed code instead. The rules encode
//! conventions from `docs/development/style-guide.md` at the repo root.

use gh_workflow::{Event, Job, Level, Permissions, Run, Step, Workflow, WorkflowCall};
use xtask_paths::RepoGlob;

use crate::workflows::{runners, steps, vars};

/// Files whose change makes `PR CI` call this workflow.
pub const PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("crates/**"),
    xtask_paths::repo_glob!("services/**"),
    xtask_paths::repo_glob!("tooling/xtask/**"),
    xtask_paths::repo_glob!("apps/web/**"),
    xtask_paths::repo_glob!("packages/**"),
    xtask_paths::repo_glob!("rules/**"),
    xtask_paths::repo_glob!("sgconfig.yml"),
    xtask_paths::repo_glob!(".github/actions/teardown-nix/**"),
    xtask_paths::repo_glob!(".github/workflows/code_check_conventions.yml"),
];

/// ast-grep is fetched with bunx, so this shares the `web-ci` bun cache volume
/// the way the infra checks do.
fn conventions_runner() -> String {
    runners::Runner::Small.with_cache_tag(vars::WEB_CI_CACHE_TAG)
}

/// Build the workflow.
pub fn code_check_conventions() -> Workflow {
    Workflow::new("conventions code check")
        // Read-only: the workflow only checks out code and runs a scan.
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default().workflow_call(WorkflowCall::default()))
        .add_job("ast-grep", ast_grep())
}

fn ast_grep() -> Job {
    Job::default()
        .timeout_minutes(15u32)
        .name("ast-grep Conventions")
        .runs_on(conventions_runner())
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_web_cache_volume(false))
        .add_step(steps::setup_nix())
        .add_step(steps::setup_dev_shell())
        .add_step(run_ast_grep())
        .add_step(steps::teardown_nix())
}

fn run_ast_grep() -> Step<Run> {
    Step::new("Run ast-grep").run("bunx --yes @ast-grep/cli@0.44.1 scan")
}
