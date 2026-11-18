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

use std::collections::HashMap;

use anyhow::Result;
use gh_workflow::{
    Event, Expression, Job, Level, Permissions, Run, Step, Use, Workflow, WorkflowDispatch,
    WorkflowDispatchInput,
};

use crate::workflows::{build_dmg_on_tag, runners, steps};

const NIX_CACHE_SIZE_GB: u16 = 100;
/// A cold Chromium build is slow; stop a hung job before it bills for hours.
const TIMEOUT_MINUTES: u32 = 120;
/// Where the harness writes, and what the artifact holds.
const OUT: &str = "${{ runner.temp }}/qa-out";

/// Build the workflow. The dispatch inputs and `run-name` are added by [`patch`].
pub fn desktop_qa_macos() -> Workflow {
    Workflow::new("Desktop QA macOS")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default().workflow_dispatch(WorkflowDispatch {
            inputs: HashMap::<String, WorkflowDispatchInput>::new(),
        }))
        .add_job("qa-macos", qa_macos_job())
}

/// What `gh_workflow` cannot express: ordered dispatch inputs with a `choice`,
/// and a `run-name` that carries the suite, ref and report key so a run is
/// recognisable in the Actions list.
pub fn patch(root: &mut serde_yaml::Value) -> Result<()> {
    let mapping = root
        .as_mapping_mut()
        .ok_or_else(|| anyhow::anyhow!("rendered workflow is not a mapping"))?;
    let on = mapping
        .get_mut("on")
        .and_then(serde_yaml::Value::as_mapping_mut)
        .ok_or_else(|| anyhow::anyhow!("rendered workflow has no `on` mapping"))?;
    on.insert(
        "workflow_dispatch".into(),
        crate::workflows::yaml_fragment(indoc::indoc! {r#"
            inputs:
              ref:
                description: Git ref (branch, tag or sha) of macro-inc/macro to build and test
                required: true
                type: string
              suite:
                description: smoke = launch checks; full = smoke plus DevTools probe, longer soak and cargo test
                required: true
                type: choice
                default: smoke
                options:
                  - smoke
                  - full
              report:
                description: Optional work item key of the factory (echoed into the run name and summary)
                required: false
                type: string
                default: ''
        "#})?,
    );
    mapping.insert(
        "run-name".into(),
        "macOS QA ${{ inputs.suite }} ${{ inputs.ref }}${{ inputs.report && format(' [{0}]', inputs.report) || '' }}"
            .into(),
    );
    Ok(())
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
        .add_env(("QA_SUITE", "${{ inputs.suite }}"))
        .add_env(("QA_REF", "${{ inputs.ref }}"))
        .add_env(("QA_REPORT", "${{ inputs.report }}"))
        .add_step(steps::checkout_ref("${{ inputs.ref }}"))
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
    Step::new("Checkout QA harness")
        .uses(
            "actions",
            "checkout",
            "df4cb1c069e1874edd31b4311f1884172cec0e10",
        ) // v6
        .add_with(("ref", "${{ github.sha }}"))
        .add_with(("path", ".qa-harness"))
        .add_with(("sparse-checkout", "apps/web/tests/macos"))
        .add_with(("persist-credentials", false))
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
        .if_condition(Expression::new("inputs.suite == 'full'"))
        .continue_on_error(true)
}

fn run_harness() -> Step<Run> {
    Step::new("Launch the app and run the QA checks")
        .run(include_str!("scripts/qa_run_macos.sh"))
        .shell("bash")
}

fn upload_results() -> Step<Use> {
    Step::new("Upload QA results")
        .uses(
            "actions",
            "upload-artifact",
            "ea165f8d65b6e75b540449e92b4886f43607fa02",
        ) // v4
        .add_with(("name", "macos-qa-${{ github.run_id }}"))
        .add_with(("path", OUT))
        .add_with(("if-no-files-found", "warn"))
        .add_with(("retention-days", 14))
        .if_condition(Expression::new("!cancelled()"))
}
