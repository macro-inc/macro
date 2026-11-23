//! The Windows desktop installer: a per-user NSIS installer around the wry
//! (WebView2) app, built with MSVC on the Namespace Windows runner from a
//! frontend Nix builds on Linux.
//!
//! [`super::build_desktop_on_tag`] runs these jobs on every desktop tag; the
//! installer is Authenticode-signed when the signing variables are set (see
//! [`vars::WINDOWS_SIGNING_AZURE_TENANT_ID`]) and published only when
//! [`vars::WINDOWS_DESKTOP_RELEASE`] also allows it. A Windows failure never
//! holds back the macOS and Linux release, but the release waits for the
//! Windows job to end, so keep the signing environment free of required
//! reviewers and wait timers.
//!
//! `Desktop Windows smoke` builds the same installer unsigned for pull requests
//! that touch the app, installs it silently, launches it and checks its page
//! over the WebView2 DevTools protocol, then uninstalls. `PR CI` calls it
//! outside `CI gate`. Generated into `desktop_windows.yml`.

use gh_workflow::expr::typed::{Expr, Flag, JobHandle, StepHandle, StepOutput, Str, github};
use gh_workflow::{
    Environment, Event, Job, Level, Permissions, Run, Step, Use, Workflow, WorkflowCall,
    WorkflowDispatch,
};
use xtask_paths::RepoGlob;

use crate::workflows::actions::ActionsDownloadArtifact;
use crate::workflows::{build_appimage_on_tag, runners, steps, vars};

#[cfg(test)]
mod test;

/// The tauri-cli release nixpkgs bundles the AppImage with.
const TAURI_CLI_VERSION: &str = "2.11.4";

/// The GitHub environment whose OIDC subject the signing identity trusts:
/// `repo:macro-inc/macro:environment:desktop-windows-signing`.
const SIGNING_ENVIRONMENT: &str = "desktop-windows-signing";

/// Files whose change makes `PR CI` call the smoke workflow: the app, the
/// Tauri crates it links on Windows, and this build.
pub const PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("apps/web/tauri/src-tauri/**"),
    xtask_paths::repo_glob!("apps/web/tauri/Cargo.toml"),
    xtask_paths::repo_glob!("apps/web/tauri/Cargo.lock"),
    xtask_paths::repo_glob!("apps/web/tauri/graphql_cache_plugin/**"),
    xtask_paths::repo_glob!("apps/web/tauri/logger/**"),
    xtask_paths::repo_glob!("apps/web/tauri/macro_bundle_updater_plugin/**"),
    xtask_paths::repo_glob!("apps/web/tauri/navigation_plugin/**"),
    xtask_paths::repo_glob!("apps/web/tauri/ios_push_plugin/**"),
    xtask_paths::repo_glob!("apps/web/tauri/staged_upload_constants/**"),
    xtask_paths::repo_glob!("apps/web/scripts/desktop-release.mjs"),
    xtask_paths::repo_glob!(
        "tooling/xtask/crates/xtask_workflows/src/workflows/desktop_windows.rs"
    ),
    xtask_paths::repo_glob!("tooling/xtask/crates/xtask_workflows/src/workflows/scripts/*windows*"),
    xtask_paths::repo_glob!(".github/workflows/desktop_windows.yml"),
];

/// Builds the frontend the Windows job bundles.
pub(crate) const WINDOWS_FRONTEND: JobHandle<()> = JobHandle::new("build-windows-frontend", ());
/// Builds, checks and uploads the installer.
pub(crate) const BUILD_WINDOWS: JobHandle<()> = JobHandle::new("build-windows", ());

struct SigningOutputs {
    /// The installer and what it installs will be signed.
    signed: StepOutput<Flag>,
    /// The installer may reach the release, the feed and the download pages.
    publish: StepOutput<Flag>,
}

const SIGNING: StepHandle<SigningOutputs> = StepHandle::new(
    "signing",
    SigningOutputs {
        signed: StepOutput::new("signing", "signed"),
        publish: StepOutput::new("signing", "publish"),
    },
);

/// How a Windows build ends.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Purpose {
    /// A desktop tag: signed and published when configured to be.
    Release,
    /// A pull request: unsigned, never published, no PostHog key.
    Smoke,
}

/// Build the smoke workflow.
pub fn desktop_windows_smoke() -> Workflow {
    Workflow::new("Desktop Windows smoke")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default()
            .workflow_call(WorkflowCall::default())
            .workflow_dispatch(WorkflowDispatch::default()))
        .add_job(
            WINDOWS_FRONTEND,
            frontend_job(github().git_ref(), Purpose::Smoke),
        )
        .add_job(
            BUILD_WINDOWS,
            windows_job(github().git_ref(), Purpose::Smoke).add_needs(WINDOWS_FRONTEND),
        )
}

fn frontend_artifact() -> String {
    format!(
        "windows-frontend-{}",
        steps::ARTIFACT_METADATA.outputs.safe_tag.read()
    )
}

/// Builds `.#tauri-frontend` with the release identity of `ref_expr` and
/// uploads it with the Tauri config the Windows build merges.
pub(crate) fn frontend_job(ref_expr: Expr<Str>, purpose: Purpose) -> Job {
    let build = Step::new("Build frontend with Nix")
        .run(include_str!("scripts/build_windows_frontend.sh"))
        .shell("bash");
    let build = match purpose {
        Purpose::Release => build
            .add_env(("VITE_POSTHOG_API_KEY", vars::POSTHOG_API_KEY))
            .add_env(("REQUIRE_POSTHOG_API_KEY", "true")),
        Purpose::Smoke => build,
    };
    Job::default()
        .name("Build Windows frontend")
        .runs_on(runners::Runner::Mid.with_cache_tag("desktop-windows-frontend"))
        .timeout_minutes(45u32)
        .add_step(steps::checkout_ref(ref_expr.clone()))
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::derive_artifact_metadata(ref_expr.clone()))
        .add_step(build_appimage_on_tag::prepare_desktop_release(ref_expr))
        .add_step(build)
        .add_step(steps::upload_artifact(
            &frontend_artifact(),
            xtask_paths::runtime_path!("windows-input"),
        ))
        .add_step(steps::teardown_nix())
}

/// Builds the installer, smoke-tests it and uploads it: as `macro-windows-*`,
/// which the release jobs publish, only when it may be published.
pub(crate) fn windows_job(ref_expr: Expr<Str>, purpose: Purpose) -> Job {
    let configure_signing = match purpose {
        Purpose::Release => configure_signing().add_env((
            "SIGN",
            ref_expr
                .clone()
                .starts_with("refs/tags/v")
                .then_else::<Str>("true", "false"),
        )),
        Purpose::Smoke => configure_signing().add_env(("SIGN", "false")),
    };
    let job = Job::default()
        .name("Build Windows installer")
        .runs_on(runners::Runner::Windows.to_string())
        // A cold build compiles macrod, tauri-cli and the app in release.
        .timeout_minutes(120u32)
        .add_env(("TAURI_CLI_VERSION", TAURI_CLI_VERSION))
        .add_step(steps::checkout_ref(ref_expr.clone()))
        .add_step(steps::setup_rust_light())
        .add_step(steps::derive_artifact_metadata(ref_expr))
        .add_step(
            ActionsDownloadArtifact::new("Download frontend")
                .name(frontend_artifact())
                .path("windows-input")
                .step(),
        )
        .add_step(configure_signing)
        .add_step(
            Step::new("Build bundled macrod")
                .run(include_str!("scripts/build_agent_daemon_windows.sh"))
                .shell("bash")
                .add_env(("TARGET", "x86_64-pc-windows-msvc")),
        )
        .add_step(
            Step::new("Build installer")
                .run(include_str!("scripts/build_windows_installer.sh"))
                .shell("bash"),
        )
        .add_step(
            Step::new("Install, launch and uninstall")
                .run(include_str!("scripts/windows_installer_smoke.ps1"))
                .shell("pwsh")
                .add_env(("EXPECT_SIGNED", SIGNING.outputs.signed.read())),
        )
        .add_step(upload_installer());
    match purpose {
        Purpose::Release => job
            .permissions(Permissions {
                contents: Some(Level::Read),
                // The signing dlib exchanges the job's OIDC token for Azure.
                id_token: Some(Level::Write),
                ..Default::default()
            })
            .environment(Environment {
                name: SIGNING_ENVIRONMENT.to_string(),
                url: None,
            })
            .add_env(("AZURE_TENANT_ID", vars::WINDOWS_SIGNING_AZURE_TENANT_ID))
            .add_env(("AZURE_CLIENT_ID", vars::WINDOWS_SIGNING_AZURE_CLIENT_ID))
            .add_env(("ARTIFACT_SIGNING_ENDPOINT", vars::WINDOWS_SIGNING_ENDPOINT))
            .add_env(("ARTIFACT_SIGNING_ACCOUNT", vars::WINDOWS_SIGNING_ACCOUNT))
            .add_env(("ARTIFACT_SIGNING_PROFILE", vars::WINDOWS_SIGNING_PROFILE))
            .add_env(("WINDOWS_DESKTOP_RELEASE", vars::WINDOWS_DESKTOP_RELEASE)),
        Purpose::Smoke => job,
    }
}

fn configure_signing() -> Step<Run> {
    Step::new("Configure Authenticode signing")
        .run(include_str!("scripts/configure_windows_signing.ps1"))
        .shell("pwsh")
        .id(SIGNING.id())
}

/// `macro-windows-*` joins the release's `macro-*` build artifacts; anything
/// else stays in the workflow run for people to test.
fn upload_installer() -> Step<Use> {
    let prefix = SIGNING
        .outputs
        .publish
        .read()
        .is_set()
        .then_else("macro-windows", "windows-installer");
    steps::upload_artifact(
        &format!(
            "{prefix}-{}",
            steps::ARTIFACT_METADATA.outputs.safe_tag.read()
        ),
        xtask_paths::runtime_path!("artifacts/*"),
    )
}
