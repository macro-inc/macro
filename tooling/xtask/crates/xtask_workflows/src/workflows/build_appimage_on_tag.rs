//! `Build AppImage` — reusable workflow that builds the Tauri desktop AppImage
//! via Nix. Called from [`super::build_desktop_on_tag`].

use gh_workflow::expr::typed::{Expr, JobHandle, Str, input};
use gh_workflow::{
    Event, Job, Level, Permissions, Run, Step, Workflow, WorkflowCall, WorkflowCallSecret,
    WorkflowInput,
};
use indexmap::IndexMap;

use crate::workflows::{runners, steps, vars};

/// Tag pattern for desktop release builds (CalVer: `v2026.6.23.1`).
/// Shared with the DMG workflow and the parent orchestrator.
pub const DESKTOP_TAG_PATTERN: &str = "v[0-9]*";

/// The AppImage build job, here and in the desktop release orchestrator.
pub(crate) const BUILD_APPIMAGE: JobHandle<()> = JobHandle::new("build-appimage", ());

/// Secrets a caller must forward to the reusable desktop build workflows. A
/// called workflow cannot read repository secrets on its own, and the desktop
/// bundle is built with PostHog's key inlined, so the key has to arrive here.
/// The parent orchestrator inlines these jobs instead, and reads the secret
/// directly.
pub fn desktop_build_secrets() -> IndexMap<String, WorkflowCallSecret> {
    IndexMap::from([(
        "POSTHOG_API_KEY".to_string(),
        WorkflowCallSecret::default()
            .description("PostHog project API key inlined into the desktop bundle")
            .required(true),
    )])
}

/// Build the reusable workflow.
pub fn build_appimage() -> Workflow {
    Workflow::new("Build AppImage")
        .on(Event::default().workflow_call(
            WorkflowCall::default()
                .add_input(
                    "ref",
                    WorkflowInput::string()
                        .description("Git ref to check out and build")
                        .required(true),
                )
                .secrets(desktop_build_secrets()),
        ))
        .add_job(BUILD_APPIMAGE, build_appimage_job(input("ref")))
}

/// Build the AppImage job, checking out and naming artifacts from `ref_expr`.
pub fn build_appimage_job(ref_expr: Expr<Str>) -> Job {
    Job::default()
        .name("Build AppImage")
        .runs_on(runners::Runner::Mid.with_cache_tag("desktop-linux"))
        .add_step(steps::checkout_ref(ref_expr.clone()))
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::derive_artifact_metadata(ref_expr.clone()))
        .add_step(prepare_desktop_release(ref_expr))
        .add_step(nix_build_appimage())
        .add_step(collect_appimage())
        .add_step(steps::upload_artifact(
            &format!(
                "macro-appimage-{}",
                steps::ARTIFACT_METADATA.outputs.safe_tag.read()
            ),
            xtask_paths::runtime_path!("artifacts/*"),
        ))
        .add_step(steps::teardown_nix())
}

/// Embed one release identity in the native app and its bundled frontend.
pub fn prepare_desktop_release(ref_expr: Expr<Str>) -> Step<Run> {
    Step::new("Prepare desktop release identity")
        .run("nix develop --command bun apps/web/scripts/desktop-release.mjs prepare \"$RAW_REF\"")
        .shell("bash")
        .add_env(("RAW_REF", ref_expr))
}

/// Publish desktop artifacts from the workflow run to the release tag.
pub fn publish_job(
    ref_expr: Expr<Str>,
    artifacts_path: xtask_paths::RuntimePath<'_>,
    artifact_pattern: Option<&str>,
) -> Job {
    Job::default()
        .name("Upload Release Artifacts")
        .runs_on("ubuntu-latest")
        .permissions(Permissions {
            contents: Some(Level::Write),
            ..Default::default()
        })
        .add_step(steps::derive_artifact_metadata(ref_expr))
        .add_step(steps::download_artifacts(
            xtask_paths::runtime_path!("release-artifacts"),
            artifact_pattern,
        ))
        .add_step(steps::upload_release_artifacts(artifacts_path))
}

fn nix_build_appimage() -> Step<Run> {
    Step::new("Build AppImage with Nix")
        .run(include_str!("scripts/build_appimage.sh"))
        .shell("bash")
        .add_env(("VITE_POSTHOG_API_KEY", vars::POSTHOG_API_KEY))
}

fn collect_appimage() -> Step<Run> {
    Step::new("Collect AppImage artifact")
        .run(include_str!("scripts/collect_appimage.sh"))
        .shell("bash")
}
