//! `infra code check` — PR checks for the infra (Pulumi TypeScript) workspace.
//! Generated into `code_check_infra.yml`. `PR CI` calls it only when [`PATHS`]
//! changed, and `CI gate` reads the call's result, so it has no path-check or
//! roll-up job of its own.

use gh_workflow::{Event, Job, Run, Step, Use, Workflow, WorkflowCall, ZizmorRule};
use xtask_paths::RepoGlob;

use crate::workflows::actions::ActionsCheckout;
use crate::workflows::{runners, steps, vars};

/// Files whose change makes `PR CI` call this workflow.
pub const PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("infra/**"),
    xtask_paths::repo_glob!("flake.nix"),
    xtask_paths::repo_glob!("flake.lock"),
    xtask_paths::repo_glob!(".github/actions/setup-nix-dev-shell/**"),
    xtask_paths::repo_glob!(".github/actions/teardown-nix/**"),
    xtask_paths::repo_glob!(".github/workflows/code_check_infra.yml"),
];

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
        .on(Event::default().workflow_call(WorkflowCall::default()))
        .add_job("biome-check", biome_check())
        .add_job("check", check())
}

fn biome_check() -> Job {
    Job::default()
        .timeout_minutes(15u32)
        .name("Biome Check")
        .runs_on(infra_runner())
        .add_step(checkout(true))
        .add_step(steps::prepare_blobless_checkout())
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_dev_shell())
        .add_step(run_biome())
        .add_step(steps::teardown_nix())
}

fn check() -> Job {
    Job::default()
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

fn checkout(full_history: bool) -> Step<Use> {
    let checkout = ActionsCheckout::new("Checkout Repo");
    // `biome --changed` needs the merge base, not old blobs.
    let checkout = if full_history {
        checkout.fetch_depth(0).filter("blob:none")
    } else {
        checkout
    };
    checkout.step().zizmor_ignore(
        ZizmorRule::Artipacked,
        "bun and Pulumi tooling run from the checkout",
    )
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
