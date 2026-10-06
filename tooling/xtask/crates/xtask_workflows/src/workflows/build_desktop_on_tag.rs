//! `Build Desktop on Tag` — orchestrator workflow that triggers AppImage and DMG
//! builds in parallel when a release tag is pushed. Also supports manual
//! dispatch. Generated into `build_desktop_on_tag.yml`.
//!
//! The reusable job definitions live in [`super::build_appimage_on_tag`] and
//! [`super::build_dmg_on_tag`].

use std::collections::HashMap;

use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, Push, Run, Step, Workflow,
    WorkflowDispatch, WorkflowDispatchInput,
};

use crate::workflows::{build_appimage_on_tag, build_dmg_on_tag, steps, vars};

const RESOLVED_REF: &str = "${{ needs.resolve-ref.outputs.ref }}";

/// Build the workflow.
pub fn build_desktop_on_tag() -> Workflow {
    Workflow::new("Build Desktop on Tag")
        .on(desktop_events())
        .concurrency(
            Concurrency::new(Expression::new("desktop-${{ inputs.ref || (github.event.ref_type == 'tag' && github.event.ref || github.ref_name) }}"))
                .cancel_in_progress(true),
        )
        .add_job("resolve-ref", resolve_ref())
        .add_job(
            "build-appimage",
            build_appimage_on_tag::build_appimage_job(RESOLVED_REF).add_needs("resolve-ref"),
        )
        .add_job(
            "build-dmg",
            build_dmg_on_tag::build_dmg_job(RESOLVED_REF).add_needs("resolve-ref"),
        )
        .add_job(
            "publish-release",
            publish_desktop_job()
                .add_needs("resolve-ref")
                .add_needs("build-appimage")
                .add_needs("build-dmg"),
        )
}

fn publish_desktop_job() -> Job {
    Job::default()
        .name("Sign and publish desktop updates")
        .runs_on("ubuntu-latest")
        // Serialize channel promotion across tags; an older build cannot win a race.
        .concurrency(
            Concurrency::new(Expression::new("desktop-stable-publish")).cancel_in_progress(false),
        )
        .cond(Expression::new(
            "startsWith(needs.resolve-ref.outputs.ref, 'refs/tags/v')",
        ))
        .permissions(Permissions {
            contents: Some(Level::Write),
            ..Default::default()
        })
        .add_step(steps::checkout_ref(RESOLVED_REF))
        .add_step(steps::setup_nix())
        .add_step(steps::derive_artifact_metadata(RESOLVED_REF))
        .add_step(steps::download_artifacts(xtask_paths::runtime_path!(
            "release-artifacts"
        )))
        .add_step(
            Step::new("Sign updater artifacts")
                .run(include_str!("scripts/sign_desktop_updates.sh"))
                .shell("bash")
                .add_env(("DOPPLER_TOKEN", vars::MACOS_RELEASE_DOPPLER_TOKEN))
                .add_env(("GH_TOKEN", "${{ github.token }}"))
                .add_env(("RELEASE_TAG", "${{ steps.metadata.outputs.tag }}"))
                .add_env(("RELEASE_REPOSITORY", "${{ github.repository }}")),
        )
        .add_step(
            Step::new("Publish desktop release and update feed")
                .run(include_str!("scripts/publish_desktop_updates.sh"))
                .shell("bash")
                .add_env(("GH_TOKEN", "${{ github.token }}"))
                .add_env(("RELEASE_TAG", "${{ steps.metadata.outputs.tag }}"))
                .add_env(("RELEASE_REPOSITORY", "${{ github.repository }}")),
        )
        .add_step(steps::teardown_nix())
}

fn desktop_events() -> Event {
    Event::default()
        .push(Push::default().add_tag(build_appimage_on_tag::DESKTOP_TAG_PATTERN))
        .workflow_dispatch(workflow_dispatch())
}

fn workflow_dispatch() -> WorkflowDispatch {
    let mut inputs = HashMap::new();
    inputs.insert(
        "ref".into(),
        WorkflowDispatchInput {
            description: "Optional release tag override (v* or refs/tags/v*). Leave empty to build the branch or tag selected for this workflow run.".into(),
            required: false,
            input_type: "string".into(),
            default: None,
        },
    );

    WorkflowDispatch { inputs }
}

fn resolve_ref() -> Job {
    Job::default()
        .cond(Expression::new(
            "github.event_name == 'workflow_dispatch' || github.event_name == 'push' || (github.event_name == 'create' && github.event.ref_type == 'tag')",
        ))
        .name("Resolve build ref")
        .runs_on("ubuntu-latest")
        .add_output("ref", "${{ steps.resolve.outputs.ref }}")
        .add_step(resolve_ref_step())
}

fn resolve_ref_step() -> Step<Run> {
    Step::new("Resolve ref")
        .run(include_str!("scripts/resolve_desktop_ref.sh"))
        .id("resolve")
        .shell("bash")
        .add_env(("EVENT_NAME", "${{ github.event_name }}"))
        .add_env(("INPUT_REF", "${{ inputs.ref }}"))
        .add_env(("GITHUB_EVENT_REF", "${{ github.event.ref }}"))
        .add_env(("GITHUB_EVENT_REF_TYPE", "${{ github.event.ref_type }}"))
        .add_env(("SELECTED_REF", "${{ github.ref }}"))
}
