//! `Build macOS DMG` — reusable workflow that builds the Tauri desktop DMG via
//! Nix. The release orchestrator also uses its build job directly.

use gh_workflow::expr::typed::{Expr, JobHandle, StepHandle, Str, cancelled, input};
use gh_workflow::{
    Event, Job, Run, Step, Workflow, WorkflowCall, WorkflowCallSecret, WorkflowInput,
};

use crate::workflows::{build_appimage_on_tag, runners, steps, vars};

#[cfg(test)]
mod test;

const NIX_CACHE_SIZE_GB: u16 = 100;

/// The DMG build job, here and in the desktop release orchestrator.
pub(crate) const BUILD_DMG: JobHandle<()> = JobHandle::new("build-dmg", ());
/// The [`configure_nix_cache`] step.
const NIX_CACHE: StepHandle<()> = StepHandle::new("nix-cache", ());

/// Build the reusable workflow.
pub fn build_dmg() -> Workflow {
    Workflow::new("Build macOS DMG")
        .on(Event::default().workflow_call(
            WorkflowCall::default()
                .add_input(
                    "ref",
                    WorkflowInput::string()
                        .description("Git ref to check out and build")
                        .required(true),
                )
                .secrets(build_appimage_on_tag::desktop_build_secrets())
                .add_secret(
                    "MACOS_DEVELOPER_ID_CERTIFICATE_BASE64",
                    WorkflowCallSecret::default()
                        .description("Developer ID certificate for signing the macOS app")
                        .required(true),
                )
                .add_secret(
                    "MACOS_DEVELOPER_ID_CERTIFICATE_PASSWORD",
                    WorkflowCallSecret::default()
                        .description("Password for the Developer ID certificate")
                        .required(true),
                )
                .add_secret(
                    "MACOS_DEVELOPER_ID_PROVISIONING_PROFILE_BASE64",
                    WorkflowCallSecret::default()
                        .description(
                            "Developer ID provisioning profile for the notification entitlements",
                        )
                        .required(true),
                )
                .add_secret(
                    "MACOS_RELEASE_DOPPLER_TOKEN",
                    WorkflowCallSecret::default()
                        .description("Doppler token for notarizing the macOS DMG")
                        .required(true),
                ),
        ))
        .add_job(BUILD_DMG, build_dmg_job(input("ref")))
}

/// Build the macOS DMG job, checking out and naming artifacts from `ref_expr`.
pub fn build_dmg_job(ref_expr: Expr<Str>) -> Job {
    Job::default()
        .name("Build macOS DMG")
        .runs_on(vec![
            format!("{}-with-cache", runners::Runner::MacOsArmLarge),
            "nscloud-cache-tag-macro-desktop-macos".to_owned(),
            format!("nscloud-cache-size-{NIX_CACHE_SIZE_GB}gb"),
        ])
        .add_env(("DESKTOP_NIX_CACHE_SIZE_GB", NIX_CACHE_SIZE_GB.to_string()))
        .add_step(steps::checkout_ref(ref_expr.clone()))
        .add_step(assert_arm64())
        .add_step(steps::mount_macos_nix_cache_volume())
        .add_step(steps::install_nix_macos())
        .add_step(configure_nix_cache())
        .add_step(configure_signing_identity())
        .add_step(steps::derive_artifact_metadata(ref_expr.clone()))
        .add_step(build_appimage_on_tag::prepare_desktop_release(ref_expr))
        .add_step(nix_build_dmg())
        .add_step(save_nix_cache())
        .add_step(collect_dmg())
        .add_step(validate_signed_dmg())
        .add_step(prepare_cloudkit_tcp())
        .add_step(notarize_dmg())
        .add_step(steps::upload_artifact(
            &format!(
                "macro-dmg-{}",
                steps::ARTIFACT_METADATA.outputs.safe_tag.read()
            ),
            xtask_paths::runtime_path!("artifacts/*"),
        ))
}

pub(super) fn assert_arm64() -> Step<Run> {
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
        .add_env((
            "MACOS_DEVELOPER_ID_PROVISIONING_PROFILE_BASE64",
            vars::MACOS_DEVELOPER_ID_PROVISIONING_PROFILE_BASE64,
        ))
}

fn nix_build_dmg() -> Step<Run> {
    Step::new("Build DMG with Nix")
        .run(include_str!("scripts/build_dmg.sh"))
        .shell("bash")
        .add_env(("VITE_POSTHOG_API_KEY", vars::POSTHOG_API_KEY))
}

pub(super) fn configure_nix_cache() -> Step<Run> {
    Step::new("Configure macOS Nix binary cache")
        .run(include_str!("scripts/configure_macos_nix_cache.sh"))
        .id(NIX_CACHE.id())
        .shell("bash")
        .continue_on_error(true)
}

pub(super) fn save_nix_cache() -> Step<Run> {
    Step::new("Prune and save macOS Nix build dependencies")
        .run(include_str!("scripts/save_macos_nix_cache.sh"))
        .shell("bash")
        .if_condition((!cancelled()).and(NIX_CACHE.outcome().eq("success")))
        .continue_on_error(true)
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

fn notarize_dmg() -> Step<Run> {
    Step::new("Notarize and staple DMG")
        .run(include_str!("scripts/notarize_dmg.sh"))
        .shell("bash")
        .add_env(("DOPPLER_TOKEN", vars::MACOS_RELEASE_DOPPLER_TOKEN))
}

fn prepare_cloudkit_tcp() -> Step<Run> {
    Step::new("Prepare CloudKit TCP fallback")
        .run(format!(
            "set -euo pipefail\ncat > \"$RUNNER_TEMP/macro-cloudkit-tcp.sh\" <<'MACRO_CLOUDKIT_TCP'\n{}\nMACRO_CLOUDKIT_TCP\n",
            include_str!("scripts/cloudkit_tcp.sh")
        ))
        .shell("bash")
}
