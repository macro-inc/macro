//! `conventions code check` — repo convention lints, generated into
//! `code_check_conventions.yml`.
//!
//! Runs `ast-grep scan` over the custom structural rules in `rules/ast-grep`
//! (config: `sgconfig.yml` at the repo root). The scan fails only on
//! `severity: error` findings; `warning`/`hint` rules surface through
//! CodeRabbit's ast-grep integration on changed code instead. The rules encode
//! conventions from `STYLE_GUIDE.md` at the repo root.

use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, PullRequest, PullRequestType, Run,
    Step, Use, Workflow,
};

use crate::workflows::{runners, steps, vars};

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
        .on(Event::default().pull_request(
            PullRequest::default()
                .add_branch("main")
                .add_type(PullRequestType::Opened)
                .add_type(PullRequestType::Synchronize)
                .add_type(PullRequestType::Reopened)
                .add_type(PullRequestType::ReadyForReview),
        ))
        .concurrency(
            Concurrency::new(Expression::new("code-check-conventions-${{ github.ref }}"))
                .cancel_in_progress(true),
        )
        .add_job("path-check", path_check())
        .add_job("ast-grep", ast_grep())
        .add_job("status-check", status_check())
}

fn path_check() -> Job {
    Job::default()
        .runs_on(runners::Runner::Small.to_string())
        .add_output("should_run", "${{ steps.filter.outputs.should_run }}")
        .add_step(steps::checkout(false, false))
        .add_step(paths_filter())
}

fn ast_grep() -> Job {
    steps::gated_job()
        .name("ast-grep Conventions")
        .runs_on(conventions_runner())
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_web_cache_volume(false))
        .add_step(steps::setup_nix())
        .add_step(steps::setup_dev_shell())
        .add_step(run_ast_grep())
}

/// Always-run collector used as the required status check. Its name must stay
/// stable because branch protection references it.
fn status_check() -> Job {
    Job::default()
        .name("Conventions Status Check")
        .cond(Expression::new("always()"))
        .needs(vec!["path-check".to_string(), "ast-grep".to_string()])
        .runs_on(runners::Runner::Small.to_string())
        .add_step(check_job_results())
}

fn paths_filter() -> Step<Use> {
    Step::new("Filter changed paths")
        .uses(
            "dorny",
            "paths-filter",
            "d1c1ffe0248fe513906c8e24db8ea791d46f8590",
        ) // v3.0.3
        .id("filter")
        .add_with((
            "filters",
            indoc::indoc! {r#"
                should_run:
                  - 'rust/**'
                  - 'js/app/**'
                  - 'js/lexical-core/**'
                  - 'rules/**'
                  - 'sgconfig.yml'
                  - '.github/workflows/code_check_conventions.yml'
            "#},
        ))
}

fn run_ast_grep() -> Step<Run> {
    Step::new("Run ast-grep").run("bunx --yes @ast-grep/cli@0.44.1 scan")
}

fn check_job_results() -> Step<Run> {
    Step::new("Check job results").run(indoc::indoc! {r#"
        echo "path-check: ${{ needs.path-check.result }}"
        echo "ast-grep: ${{ needs.ast-grep.result }}"

        # Fail if any job failed, or ast-grep was cancelled (skipped and
        # success are both OK; cancelled means it started and didn't finish)
        if [[ "${{ needs.path-check.result }}" == "failure" ]] || \
           [[ "${{ needs.ast-grep.result }}" == "failure" ]] || \
           [[ "${{ needs.ast-grep.result }}" == "cancelled" ]]; then
          echo "❌ One or more jobs failed"
          exit 1
        fi

        echo "✅ All jobs passed or were skipped"
    "#})
}
