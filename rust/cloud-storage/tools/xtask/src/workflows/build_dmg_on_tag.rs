//! `Build macOS DMG` — reusable workflow that builds the Tauri desktop DMG via
//! Nix. Called from [`super::build_desktop_on_tag`].

use gh_workflow::{
    Event, Job, Run, Step, Workflow, WorkflowCall, WorkflowCallInput,
};

use crate::workflows::{steps, vars};

/// Build the reusable workflow.
pub fn build_dmg() -> Workflow {
    Workflow::new("Build macOS DMG")
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
        .add_job("build-dmg", build_dmg_job())
}

fn build_dmg_job() -> Job {
    Job::default()
        .name("Build macOS DMG")
        .runs_on("macos-15")
        .add_step(steps::checkout_ref("${{ inputs.ref }}"))
        .add_step(assert_arm64())
        .add_step(install_nix_macos())
        .add_step(steps::setup_cachix())
        .add_step(configure_signing_identity())
        .add_step(steps::derive_artifact_metadata("${{ inputs.ref }}"))
        .add_step(nix_build_dmg())
        .add_step(collect_dmg())
        .add_step(validate_signed_dmg())
        .add_step(steps::upload_artifact(
            "macro-dmg-${{ steps.metadata.outputs.safe_tag }}",
            "artifacts/*",
        ))
}

fn assert_arm64() -> Step<Run> {
    Step::new("Assert arm64 runner")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            if [ "$(uname -m)" != "arm64" ]; then
              echo "macOS DMG builds must run on an arm64/aarch64 runner, got $(uname -m)" >&2
              exit 1
            fi
        "#})
        .shell("bash")
}

fn install_nix_macos() -> Step<Run> {
    Step::new("Install Nix")
        .run(include_str!("scripts/install_nix_macos.sh"))
        .shell("bash")
}

fn configure_signing_identity() -> Step<Run> {
    Step::new("Configure signing identity")
        .run(include_str!("scripts/configure_signing_identity.sh"))
        .shell("bash")
        .add_env((
            "MACOS_DEVELOPER_ID_CERTIFICATE_BASE64",
            vars::MACOS_DEVELOPER_ID_CERTIFICATE_BASE64,
        ))
        .add_env((
            "MACOS_DEVELOPER_ID_CERTIFICATE_PASSWORD",
            vars::MACOS_DEVELOPER_ID_CERTIFICATE_PASSWORD,
        ))
}

fn nix_build_dmg() -> Step<Run> {
    Step::new("Build DMG with Nix")
        .run(include_str!("scripts/build_dmg.sh"))
        .shell("bash")
}

fn collect_dmg() -> Step<Run> {
    Step::new("Collect DMG artifact")
        .run(include_str!("scripts/collect_dmg.sh"))
        .shell("bash")
}

fn validate_signed_dmg() -> Step<Run> {
    Step::new("Validate signed DMG")
        .run(include_str!("scripts/validate_signed_dmg.sh"))
        .shell("bash")
}
