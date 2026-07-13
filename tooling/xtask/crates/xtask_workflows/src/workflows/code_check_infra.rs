//! `infra code check` — PR checks for the infra (Pulumi TypeScript) workspace.
//! Generated into `code_check_infra.yml` (replaces the hand-written
//! `code-check-infra.yml`; the required status check is the job name
//! `Infra Status Check`, which is unchanged, so branch protection is
//! unaffected by the file rename).

use gh_workflow::{
    Concurrency, Event, Expression, Job, PullRequest, PullRequestType, Run, Step, Use, Workflow,
};

use crate::workflows::{
    runners,
    steps::{self, FluentBuilder},
    vars,
};

/// The infra checks need the same cache content as the web checks (Nix
/// dev-shell closure + bun cache), so they share the `web-ci` volume — cache
/// volumes are keyed workspace-wide by tag, so `small` mounts the exact same
/// volume the web checks keep warm on `mid`. biome + tsc over infra/ are
/// light; they don't need a mid-size machine.
fn infra_runner() -> String {
    runners::Runner::Small.with_cache_tag(vars::WEB_CI_CACHE_TAG)
}

/// Build the workflow.
pub fn code_check_infra() -> Workflow {
    Workflow::new("infra code check")
        .on(Event::default().pull_request(
            PullRequest::default()
                .add_branch("main")
                .add_type(PullRequestType::Opened)
                .add_type(PullRequestType::Synchronize)
                .add_type(PullRequestType::Reopened)
                .add_type(PullRequestType::ReadyForReview),
        ))
        .concurrency(
            Concurrency::new(Expression::new("code-check-infra-${{ github.ref }}"))
                .cancel_in_progress(true),
        )
        .add_job("path-check", path_check())
        .add_job("biome-check", biome_check())
        .add_job("check", check())
        .add_job("status-check", status_check())
}

fn path_check() -> Job {
    Job::default()
        .runs_on(runners::Runner::Small.to_string())
        .add_output("should_run", "${{ steps.filter.outputs.should_run }}")
        .add_step(checkout(false))
        .add_step(paths_filter())
}

fn biome_check() -> Job {
    steps::gated_job()
        .name("Biome Check")
        .runs_on(infra_runner())
        .add_step(checkout(true))
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_dev_shell())
        .add_step(run_biome())
}

fn check() -> Job {
    steps::gated_job()
        .runs_on(infra_runner())
        .add_step(checkout(false))
        .add_step(steps::mount_web_cache_volume(false))
        .add_step(steps::setup_nix())
        .add_step(steps::setup_dev_shell())
        .add_step(bun_install())
        .add_step(bun_check())
}

/// Always-run collector used as the required status check. Its name must stay
/// stable because branch protection references it.
fn status_check() -> Job {
    Job::default()
        .name("Infra Status Check")
        .cond(Expression::new("always()"))
        .needs(vec![
            "path-check".to_string(),
            "biome-check".to_string(),
            "check".to_string(),
        ])
        .runs_on(runners::Runner::Small.to_string())
        .add_step(check_job_results())
}

fn checkout(full_history: bool) -> Step<Use> {
    Step::new("Checkout Repo")
        .uses(
            "actions",
            "checkout",
            "df4cb1c069e1874edd31b4311f1884172cec0e10",
        ) // v6
        .when(full_history, |step| step.add_with(("fetch-depth", 0)))
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
                  - 'infra/**'
                  - 'flake.nix'
                  - 'flake.lock'
                  - '.github/actions/setup-cachix/**'
                  - '.github/workflows/code_check_infra.yml'
            "#},
        ))
}

fn run_biome() -> Step<Run> {
    Step::new("Run Biome")
        .run("biome ci --changed --no-errors-on-unmatched --error-on-warnings")
        .working_directory(xtask_paths::repo_dir!("infra"))
}

fn bun_install() -> Step<Run> {
    Step::new("install")
        .run("bun install --frozen-lockfile")
        .working_directory(xtask_paths::repo_dir!("infra"))
}

fn bun_check() -> Step<Run> {
    Step::new("check")
        .run("bun run check")
        .working_directory(xtask_paths::repo_dir!("infra"))
}

fn check_job_results() -> Step<Run> {
    Step::new("Check job results").run(indoc::indoc! {r#"
        echo "path-check: ${{ needs.path-check.result }}"
        echo "biome-check: ${{ needs.biome-check.result }}"
        echo "check: ${{ needs.check.result }}"

        # Fail if any job failed (skipped and success are both OK)
        if [[ "${{ needs.path-check.result }}" == "failure" ]] || \
           [[ "${{ needs.biome-check.result }}" == "failure" ]] || \
           [[ "${{ needs.check.result }}" == "failure" ]]; then
          echo "❌ One or more jobs failed"
          exit 1
        fi

        echo "✅ All jobs passed or were skipped"
    "#})
}
