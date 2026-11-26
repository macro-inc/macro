//! `Desktop QA macOS` — builds the macOS desktop app (Chromium/CEF, unsigned)
//! from any ref on a Namespace macOS runner, launches it on the runner's GUI
//! session and checks it (window, screenshot, menu bar, crash reports, app
//! log), and runs src-tauri's Rust tests. Dispatch-only: the desktop factory
//! starts it with `gh workflow run desktop_qa_macos.yml -f ref=... -f suite=...`
//! and reads `summary.json` back from the run's artifact.
//!
//! [`qa_release_job`] runs the same harness in `Build Desktop on Tag` on the
//! signed, notarized DMG that build produced; the desktop-stable promotion needs
//! it to pass.
//!
//! The Linux native E2E harness (`apps/web/tests/native`) cannot run here:
//! `tauri-driver` does not support macOS and the app is Chromium, not
//! WebKit. The harness is `apps/web/tests/macos/qa.mjs`.
//! Generated into `desktop_qa_macos.yml`.

use gh_workflow::expr::typed::{Expr, JobHandle, Str, cancelled, format, github, input, runner};
use gh_workflow::{
    Event, Job, Level, Permissions, Run, Step, Use, Workflow, WorkflowDispatch, WorkflowInput,
};

use crate::workflows::actions::{ActionsCheckout, ActionsDownloadArtifact, ActionsUploadArtifact};
use crate::workflows::{build_dmg_on_tag, runners, steps};

/// The release QA job in `Build Desktop on Tag`.
pub(crate) const QA_RELEASE: JobHandle<()> = JobHandle::new("qa-macos", ());
/// [`QA_RELEASE`]'s name; `Alert native build failures` adds a line to its post
/// when this job failed.
pub(crate) const QA_RELEASE_JOB_NAME: &str = "QA macOS release app";
/// Launches the release QA tries before a launch check counts as failed: one
/// flaky launch must not block a release, a repeatable failure must.
const RELEASE_ATTEMPTS: u8 = 2;
/// Checks take a few minutes; the rest is the Nix dev shell from the cache.
const RELEASE_TIMEOUT_MINUTES: u32 = 45;
/// Where the release QA downloads the DMG, relative to the workspace.
const RELEASE_DMG_DIR: &str = "qa-dmg";

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

/// The macOS runner the desktop builds use, with their shared Nix cache.
fn macos_runner() -> Vec<String> {
    vec![
        format!("{}-with-cache", runners::Runner::MacOsArmLarge),
        "nscloud-cache-tag-macro-desktop-macos".to_owned(),
        format!("nscloud-cache-size-{NIX_CACHE_SIZE_GB}gb"),
    ]
}

fn qa_macos_job() -> Job {
    Job::default()
        .name("QA on macOS")
        .runs_on(macos_runner())
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
        // The desktop factory downloads this artifact by name.
        .add_step(upload_results(format!("macos-qa-{}", github().run_id())))
}

/// The smoke suite on the app in the signed, notarized DMG of `ref_expr` that
/// `build-dmg` uploaded, plus the DMG's stapled-ticket and Gatekeeper checks. It
/// launches the app with the analytics host blocked: the release app embeds the
/// production PostHog key.
pub(crate) fn qa_release_job(ref_expr: Expr<Str>) -> Job {
    Job::default()
        .name(QA_RELEASE_JOB_NAME)
        .runs_on(macos_runner())
        .timeout_minutes(RELEASE_TIMEOUT_MINUTES)
        .add_env(("DESKTOP_NIX_CACHE_SIZE_GB", NIX_CACHE_SIZE_GB.to_string()))
        .add_env(("QA_SUITE", "smoke"))
        .add_env(("QA_REF", ref_expr.clone()))
        .add_env(("QA_REPORT", ""))
        .add_env(("QA_ATTEMPTS", RELEASE_ATTEMPTS.to_string()))
        .add_env(("QA_DMG_DIR", RELEASE_DMG_DIR))
        .add_step(steps::checkout_ref(ref_expr.clone()))
        .add_step(harness_checkout())
        .add_step(record_sha())
        .add_step(build_dmg_on_tag::assert_arm64())
        .add_step(steps::mount_macos_nix_cache_volume())
        .add_step(steps::install_nix_macos())
        .add_step(build_dmg_on_tag::configure_nix_cache())
        .add_step(steps::derive_artifact_metadata(ref_expr))
        .add_step(
            ActionsDownloadArtifact::new("Download macOS DMG")
                .name(format!(
                    "macro-dmg-{}",
                    steps::ARTIFACT_METADATA.outputs.safe_tag.read()
                ))
                .path(RELEASE_DMG_DIR)
                .step(),
        )
        .add_step(
            Step::new("Copy the app out of the DMG")
                .run(include_str!("scripts/qa_release_app_macos.sh"))
                .shell("bash"),
        )
        .add_step(
            Step::new("Block analytics for the QA launch")
                .run(include_str!("scripts/qa_block_analytics_macos.sh"))
                .shell("bash"),
        )
        .add_step(run_harness())
        // Not `macro-*`: the publish jobs attach every `macro-*` artifact to the release.
        // A re-run of the failed job after a flake uploads again, and
        // upload-artifact refuses a name already taken in the run.
        .add_step(upload_results(format!(
            "macos-qa-release-{}-{}",
            github().run_id(),
            github().run_attempt()
        )))
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

fn upload_results(name: String) -> Step<Use> {
    ActionsUploadArtifact::new("Upload QA results", out())
        .name(name)
        .if_no_files_found("warn")
        .retention_days(14)
        .step()
        .if_condition(!cancelled())
}
