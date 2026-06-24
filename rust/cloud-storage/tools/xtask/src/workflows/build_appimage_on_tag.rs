//! `Build AppImage` — reusable workflow that builds the Tauri desktop AppImage
//! via Nix. Called from [`super::build_desktop_on_tag`].

use gh_workflow::{
    Event, Job, Run, Step, Workflow, WorkflowCall, WorkflowCallInput,
};

use crate::workflows::{runners, steps};

/// Tag pattern for desktop release builds (CalVer: `v2026.6.23.1`).
/// Shared with the DMG workflow and the parent orchestrator.
pub const DESKTOP_TAG_PATTERN: &str = "v[0-9]*";

/// Build the reusable workflow.
pub fn build_appimage() -> Workflow {
    Workflow::new("Build AppImage")
        .on(Event::default().workflow_call(
            WorkflowCall::default().add_input(
                "ref",
                WorkflowCallInput {
                    description: "Git ref to check out and build".into(),
                    required: true,
                    input_type: "string".into(),
                    default: None,
                },
            ),
        ))
        .add_job("build-appimage", build_appimage_job())
}

fn build_appimage_job() -> Job {
    Job::default()
        .name("Build AppImage")
        .runs_on(runners::Runner::LinuxRustCi.to_string())
        .add_step(steps::checkout_ref("${{ inputs.ref }}"))
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_cachix())
        .add_step(steps::derive_artifact_metadata("${{ inputs.ref }}"))
        .add_step(nix_build_appimage())
        .add_step(collect_appimage())
        .add_step(steps::upload_artifact(
            "macro-appimage-${{ steps.metadata.outputs.safe_tag }}",
            "artifacts/*",
        ))
        .add_step(steps::teardown_nix())
}

fn nix_build_appimage() -> Step<Run> {
    Step::new("Build AppImage with Nix")
        .run(include_str!("scripts/build_appimage.sh"))
        .shell("bash")
}

fn collect_appimage() -> Step<Run> {
    Step::new("Collect AppImage artifact")
        .run(include_str!("scripts/collect_appimage.sh"))
        .shell("bash")
}
