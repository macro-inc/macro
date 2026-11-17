//! `conventions code check` — repo convention lints, generated into
//! `code_check_conventions.yml`.
//!
//! Runs `ast-grep scan` over the custom structural rules in `rules/ast-grep`
//! (config: `sgconfig.yml` at the repo root). The scan fails only on
//! `severity: error` findings; `warning`/`hint` rules surface through
//! CodeRabbit's ast-grep integration on changed code instead. The rules encode
//! conventions from `docs/development/style-guide.md` at the repo root.

use gh_workflow::expr::typed::{Flag, JobHandle, JobOutput, StepHandle, StepOutput, always};
use gh_workflow::{Event, Job, Level, Permissions, Run, Step, Use, Workflow, WorkflowCall};

use crate::workflows::actions::DornyPathsFilter;
use crate::workflows::{runners, steps, vars};

/// ast-grep is fetched with bunx, so this shares the `web-ci` bun cache volume
/// the way the infra checks do.
fn conventions_runner() -> String {
    runners::Runner::Small.with_cache_tag(vars::WEB_CI_CACHE_TAG)
}

struct PathCheckOutputs {
    /// Whether the checks should run at all; read by [`steps::gated_job`].
    should_run: JobOutput<Flag>,
}

const PATH_CHECK: JobHandle<PathCheckOutputs> = JobHandle::new(
    "path-check",
    PathCheckOutputs {
        should_run: JobOutput::new("path-check", "should_run"),
    },
);

const AST_GREP: JobHandle<()> = JobHandle::new("ast-grep", ());

struct FilterOutputs {
    /// The `should_run` filter's match.
    should_run: StepOutput<Flag>,
}

const FILTER: StepHandle<FilterOutputs> = StepHandle::new(
    "filter",
    FilterOutputs {
        should_run: StepOutput::new("filter", "should_run"),
    },
);

/// Build the workflow.
pub fn code_check_conventions() -> Workflow {
    Workflow::new("conventions code check")
        // Read-only: the workflow only checks out code and runs a scan.
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default().workflow_call(WorkflowCall::default()))
        .add_job(PATH_CHECK, path_check())
        .add_job(AST_GREP, ast_grep())
        .add_job("status-check", status_check())
}

fn path_check() -> Job {
    Job::default()
        .timeout_minutes(10u32)
        .runs_on(runners::Runner::Small.to_string())
        .add_output(
            PATH_CHECK.outputs.should_run.name(),
            FILTER.outputs.should_run.read(),
        )
        .add_step(steps::checkout(false, false))
        .add_step(paths_filter())
}

fn ast_grep() -> Job {
    steps::gated_job(&PATH_CHECK.outputs.should_run)
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

/// Always-run collector used as the required status check. Its name must stay
/// stable because branch protection references it.
fn status_check() -> Job {
    Job::default()
        .timeout_minutes(5u32)
        .name("Conventions Status Check")
        .cond(always())
        .needs(vec![PATH_CHECK.to_string(), AST_GREP.to_string()])
        .runs_on(runners::Runner::Small.to_string())
        .add_step(check_job_results())
}

fn paths_filter() -> Step<Use> {
    DornyPathsFilter::new(
        "Filter changed paths",
        indoc::indoc! {r#"
                should_run:
                  - 'crates/**'
                  - 'services/**'
                  - 'tooling/xtask/**'
                  - 'apps/web/**'
                  - 'packages/**'
                  - 'rules/**'
                  - 'sgconfig.yml'
                  - '.github/actions/teardown-nix/**'
                  - '.github/workflows/code_check_conventions.yml'
            "#},
    )
    .step()
    .id(FILTER.id())
}

fn run_ast_grep() -> Step<Run> {
    Step::new("Run ast-grep").run("bunx --yes @ast-grep/cli@0.44.1 scan")
}

fn check_job_results() -> Step<Run> {
    Step::new("Check job results")
        .run(include_str!("code_check_conventions/check_job_results.sh"))
        .add_env(("PATH_CHECK_RESULT", PATH_CHECK.result()))
        .add_env(("AST_GREP_RESULT", AST_GREP.result()))
}
