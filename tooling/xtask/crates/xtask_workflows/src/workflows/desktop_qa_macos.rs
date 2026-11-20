//! `Desktop QA macOS` — builds the macOS desktop app (Chromium/CEF, unsigned)
//! from any ref on a Namespace macOS runner, launches it on the runner's GUI
//! session and checks it (window, screenshot, menu bar, crash reports, app
//! log), and runs src-tauri's Rust tests. Dispatch-only: the desktop factory
//! starts it with `gh workflow run desktop_qa_macos.yml -f ref=... -f suite=...`
//! and reads `summary.json` back from the run's artifact.
//!
//! The Linux native E2E harness (`apps/web/tests/native`) cannot run here:
//! `tauri-driver` does not support macOS and the app is Chromium, not
//! WebKit. The harness is `apps/web/tests/macos/qa.mjs`.
//! Generated into `desktop_qa_macos.yml`.

use gh_workflow::expr::typed::{Str, cancelled, format, github, input, runner};
use gh_workflow::{
    Event, Job, Level, Permissions, Run, Step, Use, Workflow, WorkflowDispatch, WorkflowInput,
};

use crate::workflows::actions::{ActionsCheckout, ActionsUploadArtifact};
use crate::workflows::{build_dmg_on_tag, runners, steps};

const NIX_CACHE_SIZE_GB: u16 = 100;
/// A cold Chromium build is slow; stop a hung job before it bills for hours.
const TIMEOUT_MINUTES: u32 = 120;
/// Where the harness writes, and what the artifact holds.
fn out() -> String {
    format!("{}/qa-out", runner().temp())
}

/// Build the workflow. The `run-name` carries the suite, ref and report key so
/// a run is recognisable in the Actions list.
pub fn desktop_qa_macos() -> Workflow {
    Workflow::new("Desktop QA macOS")
        .run_name(run_name())
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default().workflow_dispatch(
            WorkflowDispatch::default()
                .add_input(
                    "ref",
                    WorkflowInput::string()
                        .description(
                            "Git ref (branch, tag or sha) of macro-inc/macro to build and test",
                        )
                        .required(true),
                )
                .add_input(
                    "suite",
                    WorkflowInput::choice(["smoke", "full"])
                        .description(
                            "smoke = launch checks; full = smoke plus DevTools probe, longer soak and cargo test",
                        )
                        .required(true)
                        .default("smoke"),
                )
                .add_input(
                    "report",
                    WorkflowInput::string()
                        .description(
                            "Optional work item key of the factory (echoed into the run name and summary)",
                        )
                        .required(false)
                        .default(""),
                ),
        ))
        .add_job("qa-macos", qa_macos_job())
}

fn run_name() -> String {
    // `inputs.report` is a string; only its truthiness picks the suffix.
    let report_suffix = input::<Str>("report")
        .truthy()
        .then_else(format(" [{0}]", [input::<Str>("report").into_ast()]), "");
    format!(
        "macOS QA {} {}{report_suffix}",
        input::<Str>("suite"),
        input::<Str>("ref")
    )
}

fn qa_macos_job() -> Job {
    Job::default()
        .name("QA on macOS")
        .runs_on(vec![
            format!("{}-with-cache", runners::Runner::MacOsArmLarge),
            "nscloud-cache-tag-macro-desktop-macos".to_owned(),
            format!("nscloud-cache-size-{NIX_CACHE_SIZE_GB}gb"),
        ])
        .timeout_minutes(TIMEOUT_MINUTES)
        .add_env(("DESKTOP_NIX_CACHE_SIZE_GB", NIX_CACHE_SIZE_GB.to_string()))
        .add_env(("QA_SUITE", input::<Str>("suite")))
        .add_env(("QA_REF", input::<Str>("ref")))
        .add_env(("QA_REPORT", input::<Str>("report")))
        .add_step(steps::checkout_ref(input("ref")))
        .add_step(harness_checkout())
        .add_step(record_sha())
        .add_step(build_dmg_on_tag::assert_arm64())
        .add_step(steps::mount_macos_nix_cache_volume())
        .add_step(steps::install_nix_macos())
        .add_step(build_dmg_on_tag::configure_nix_cache())
        .add_step(build_app())
        // Not saved back: release builds own the shared Nix cache, and a QA
        // build of an arbitrary branch would only churn it.
        .add_step(cargo_test())
        .add_step(run_harness())
        .add_step(upload_results())
}

/// The harness comes from the commit that holds this workflow, not from the
/// ref under test, so any ref can be tested with the current checks.
fn harness_checkout() -> Step<Use> {
    ActionsCheckout::new("Checkout QA harness")
        .r#ref(github().sha())
        .path(".qa-harness")
        .sparse_checkout("apps/web/tests/macos")
        .persist_credentials(false)
        .step()
}

fn record_sha() -> Step<Run> {
    Step::new("Record tested commit")
        .run("echo \"QA_SHA=$(git rev-parse HEAD)\" >> \"$GITHUB_ENV\"\necho \"QA_OUT=$RUNNER_TEMP/qa-out\" >> \"$GITHUB_ENV\"")
        .shell("bash")
}

fn build_app() -> Step<Run> {
    Step::new("Build macOS app with Nix")
        .run(include_str!("scripts/qa_build_macos_app.sh"))
        .shell("bash")
}

fn cargo_test() -> Step<Run> {
    Step::new("cargo test (src-tauri)")
        .run(include_str!("scripts/qa_cargo_test_macos.sh"))
        .shell("bash")
        .if_condition(input::<Str>("suite").eq("full"))
        .continue_on_error(true)
}

fn run_harness() -> Step<Run> {
    Step::new("Launch the app and run the QA checks")
        .run(include_str!("scripts/qa_run_macos.sh"))
        .shell("bash")
}

fn upload_results() -> Step<Use> {
    ActionsUploadArtifact::new("Upload QA results", out())
        .name(format!("macos-qa-{}", github().run_id()))
        .if_no_files_found("warn")
        .retention_days(14)
        .step()
        .if_condition(!cancelled())
}
