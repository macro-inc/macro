//! `infra code check` — PR checks for the infra (Pulumi TypeScript) workspace.
//! Generated into `code_check_infra.yml` (replaces the hand-written
//! `code-check-infra.yml`; the required status check is the job name
//! `Infra Status Check`, which is unchanged, so branch protection is
//! unaffected by the file rename).

use gh_workflow::expr::typed::{Flag, JobHandle, JobOutput, StepHandle, StepOutput, always};
use gh_workflow::{Event, Job, Run, Step, Use, Workflow, WorkflowCall};

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

const BIOME_CHECK: JobHandle<()> = JobHandle::new("biome-check", ());
const CHECK: JobHandle<()> = JobHandle::new("check", ());

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
pub fn code_check_infra() -> Workflow {
    Workflow::new("infra code check")
        .on(Event::default().workflow_call(WorkflowCall::default()))
        .add_job(PATH_CHECK, path_check())
        .add_job(BIOME_CHECK, biome_check())
        .add_job(CHECK, check())
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
        .add_step(checkout(false))
        .add_step(paths_filter())
}

fn biome_check() -> Job {
    steps::gated_job()
        .timeout_minutes(15u32)
        .name("Biome Check")
        .runs_on(infra_runner())
        .add_step(checkout(true))
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_dev_shell())
        .add_step(run_biome())
        .add_step(steps::teardown_nix())
}

fn check() -> Job {
    steps::gated_job()
        .timeout_minutes(15u32)
        .runs_on(infra_runner())
        .add_step(checkout(false))
        .add_step(steps::mount_web_cache_volume(false))
        .add_step(steps::setup_nix())
        .add_step(steps::setup_dev_shell())
        .add_step(bun_install())
        .add_step(bun_check())
        .add_step(steps::teardown_nix())
}

/// Always-run collector used as the required status check. Its name must stay
/// stable because branch protection references it.
fn status_check() -> Job {
    Job::default()
        .timeout_minutes(5u32)
        .name("Infra Status Check")
        .cond(always())
        .needs(vec![
            PATH_CHECK.to_string(),
            BIOME_CHECK.to_string(),
            CHECK.to_string(),
        ])
        .runs_on(runners::Runner::Small.to_string())
        .add_step(check_job_results())
}

fn checkout(full_history: bool) -> Step<Use> {
    Step::new("Checkout Repo")
        .uses("actions", "checkout", steps::CHECKOUT_SHA)
        .when(full_history, |step| step.add_with(("fetch-depth", 0)))
}

fn paths_filter() -> Step<Use> {
    Step::new("Filter changed paths")
        .uses(
            "dorny",
            "paths-filter",
            "d1c1ffe0248fe513906c8e24db8ea791d46f8590",
        ) // v3.0.3
        .id(FILTER.id())
        .add_with((
            "filters",
            indoc::indoc! {r#"
                should_run:
                  - 'infra/**'
                  - 'flake.nix'
                  - 'flake.lock'
                  - '.github/actions/setup-nix-dev-shell/**'
                  - '.github/actions/teardown-nix/**'
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

        # Only success and skipped are OK. A job that hits its timeout reports
        # cancelled, and passing on that would merge code whose checks never ran.
        for result in \
          "${{ needs.path-check.result }}" \
          "${{ needs.biome-check.result }}" \
          "${{ needs.check.result }}"; do
          if [[ "$result" != "success" && "$result" != "skipped" ]]; then
            echo "❌ One or more jobs failed or were cancelled"
            exit 1
          fi
        done

        echo "✅ All jobs passed or were skipped"
    "#})
}
