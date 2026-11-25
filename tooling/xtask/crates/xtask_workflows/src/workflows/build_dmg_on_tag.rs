//! `Build macOS DMG` — reusable workflow that builds the Tauri desktop DMG via
//! Nix. The release orchestrator also uses its build job directly, once per
//! Mac architecture.

use gh_workflow::expr::typed::{Expr, JobHandle, StepHandle, Str, cancelled, input};
use gh_workflow::{
    Event, Job, Run, Step, Workflow, WorkflowCall, WorkflowCallSecret, WorkflowInput,
};

use crate::workflows::{build_appimage_on_tag, runners, steps, vars};

#[cfg(test)]
mod test;

const NIX_CACHE_SIZE_GB: u16 = 100;

/// The Apple silicon DMG build job, here and in the desktop release
/// orchestrator.
pub(crate) const BUILD_DMG: JobHandle<()> = JobHandle::new("build-dmg", ());
/// The Intel DMG build job of the desktop release orchestrator.
pub(crate) const BUILD_DMG_X86_64: JobHandle<()> = JobHandle::new("build-dmg-x86_64", ());

/// A Mac architecture the desktop app ships for. Both build on Apple silicon:
/// the Intel app cross-compiles (`tauri-desktop-dmg-x86_64` in
/// `nix/tauri-desktop.nix`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MacArch {
    Aarch64,
    X86_64,
}

impl MacArch {
    /// The `packages.aarch64-darwin` attribute of the signed DMG.
    fn dmg_package(self) -> &'static str {
        match self {
            MacArch::Aarch64 => "tauri-desktop-dmg",
            MacArch::X86_64 => "tauri-desktop-dmg-x86_64",
        }
    }

    /// The architecture in release file names (`Macro-<version>-<arch>-darwin.dmg`).
    fn file_arch(self) -> &'static str {
        match self {
            MacArch::Aarch64 => "aarch64",
            MacArch::X86_64 => "x86_64",
        }
    }

    /// The architecture `lipo -archs` reports for the app's Mach-O files.
    fn mach_o_arch(self) -> &'static str {
        match self {
            MacArch::Aarch64 => "arm64",
            MacArch::X86_64 => "x86_64",
        }
    }

    /// The workflow artifact, and the prefix of its checksum file. The Apple
    /// silicon names predate the Intel build.
    fn artifact(self) -> &'static str {
        match self {
            MacArch::Aarch64 => "macro-dmg",
            MacArch::X86_64 => "macro-dmg-x86_64",
        }
    }

    /// Each architecture keeps its own Nix cache volume: the last job to finish
    /// replaces a volume with only its own closure.
    fn cache_tag(self) -> &'static str {
        match self {
            MacArch::Aarch64 => "macro-desktop-macos",
            MacArch::X86_64 => "macro-desktop-macos-x86_64",
        }
    }

    fn job_name(self) -> &'static str {
        match self {
            MacArch::Aarch64 => "Build macOS DMG",
            MacArch::X86_64 => "Build macOS DMG (Intel)",
        }
    }
}
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
        .add_job(BUILD_DMG, build_dmg_job(input("ref"), MacArch::Aarch64))
}

/// Build the macOS DMG job for `arch`, checking out and naming artifacts from
/// `ref_expr`.
pub fn build_dmg_job(ref_expr: Expr<Str>, arch: MacArch) -> Job {
    Job::default()
        .name(arch.job_name())
        .runs_on(vec![
            format!("{}-with-cache", runners::Runner::MacOsArmLarge),
            format!("nscloud-cache-tag-{}", arch.cache_tag()),
            format!("nscloud-cache-size-{NIX_CACHE_SIZE_GB}gb"),
        ])
        .add_env(("DESKTOP_NIX_CACHE_SIZE_GB", NIX_CACHE_SIZE_GB.to_string()))
        // Read by the build, collect, validate and notarize scripts.
        .add_env(("DESKTOP_DMG_PACKAGE", arch.dmg_package()))
        .add_env(("DESKTOP_ARCH", arch.file_arch()))
        .add_env(("DESKTOP_MACH_O_ARCH", arch.mach_o_arch()))
        .add_env(("DESKTOP_ARTIFACT", arch.artifact()))
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
                "{}-{}",
                arch.artifact(),
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
