//! `Build Desktop on Tag` — orchestrator workflow that triggers AppImage and DMG
//! builds in parallel when a release tag is pushed. Also supports manual
//! dispatch. Generated into `build_desktop_on_tag.yml`.
//!
//! The reusable job definitions live in [`super::build_appimage_on_tag`] and
//! [`super::build_dmg_on_tag`].

use std::collections::HashMap;

use gh_workflow::{
    Concurrency, Event, Expression, Job, Push, Run, Step, Workflow, WorkflowDispatch,
    WorkflowDispatchInput,
};

use crate::workflows::{build_appimage_on_tag, build_dmg_on_tag};

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
            build_appimage_on_tag::publish_job(RESOLVED_REF, "release-artifacts/*")
                .add_needs("resolve-ref")
                .add_needs("build-appimage")
                .add_needs("build-dmg"),
        )
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
            description: "Release tag to build (v* or refs/tags/v*). Defaults to the selected protected ref or release tag.".into(),
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
        .add_env(("SELECTED_REF_NAME", "${{ github.ref_name }}"))
        .add_env(("SELECTED_REF_PROTECTED", "${{ github.ref_protected }}"))
}
