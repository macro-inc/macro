//! `Build Desktop on Tag` — orchestrator workflow that triggers AppImage and DMG
//! builds in parallel when a release tag is pushed. Also supports manual
//! dispatch. Generated into `build_desktop_on_tag.yml`.
//!
//! The actual build logic lives in the reusable workflows defined in
//! [`super::build_appimage_on_tag`] and [`super::build_dmg_on_tag`].
//!
//! This workflow uses a custom serializable type ([`DesktopWorkflow`]) rather
//! than `gh_workflow::Workflow` because `gh-workflow` 0.8's `Job` struct cannot
//! represent reusable-workflow calling jobs (`with:` + `secrets: inherit`).

use indexmap::IndexMap;
use serde::Serialize;

use crate::workflows::build_appimage_on_tag;

/// Top-level workflow structure that serializes to valid GitHub Actions YAML,
/// including calling-job fields that `gh-workflow::Job` doesn't support.
#[derive(Serialize)]
pub struct DesktopWorkflow {
    name: String,
    on: On,
    concurrency: Concurrency,
    jobs: IndexMap<String, Job>,
}

#[derive(Serialize)]
struct On {
    push: PushTrigger,
    create: serde_yml::Value,
    workflow_dispatch: WorkflowDispatch,
}

#[derive(Serialize)]
struct PushTrigger {
    tags: Vec<String>,
}

#[derive(Serialize)]
struct WorkflowDispatch {
    inputs: IndexMap<String, DispatchInput>,
}

#[derive(Serialize)]
struct DispatchInput {
    description: String,
    required: bool,
    r#type: String,
}

#[derive(Serialize)]
struct Concurrency {
    group: String,
    #[serde(rename = "cancel-in-progress")]
    cancel_in_progress: bool,
}

/// A job — either a normal job with steps or a calling job that invokes a
/// reusable workflow.
#[derive(Serialize)]
#[serde(untagged)]
enum Job {
    Normal(NormalJob),
    Calling(CallingJob),
}

#[derive(Serialize)]
struct NormalJob {
    #[serde(rename = "if", skip_serializing_if = "Option::is_none")]
    cond: Option<String>,
    name: String,
    #[serde(rename = "runs-on")]
    runs_on: String,
    outputs: IndexMap<String, String>,
    steps: Vec<Step>,
}

#[derive(Serialize)]
struct Step {
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    name: String,
    run: String,
    shell: String,
    env: IndexMap<String, String>,
}

/// A job that calls a reusable workflow — the type `gh-workflow` can't model.
#[derive(Serialize)]
struct CallingJob {
    needs: Vec<String>,
    uses: String,
    with: IndexMap<String, String>,
    secrets: String,
}

/// Build the workflow as a custom serializable value.
pub fn build_desktop_on_tag() -> DesktopWorkflow {
    let mut dispatch_inputs = IndexMap::new();
    dispatch_inputs.insert(
        "ref".to_string(),
        DispatchInput {
            description: "Release tag to build (v* or refs/tags/v*). Defaults to the selected protected ref or release tag.".into(),
            required: false,
            r#type: "string".into(),
        },
    );

    let mut jobs = IndexMap::new();
    jobs.insert("resolve-ref".to_string(), resolve_ref());
    jobs.insert(
        "build-appimage".to_string(),
        calling_job("./.github/workflows/build_appimage_on_tag.yml"),
    );
    jobs.insert(
        "build-dmg".to_string(),
        calling_job("./.github/workflows/build_dmg_on_tag.yml"),
    );

    DesktopWorkflow {
        name: "Build Desktop on Tag".into(),
        on: On {
            push: PushTrigger {
                tags: vec![build_appimage_on_tag::DESKTOP_TAG_PATTERN.into()],
            },
            create: serde_yml::Value::Mapping(serde_yml::Mapping::new()),
            workflow_dispatch: WorkflowDispatch {
                inputs: dispatch_inputs,
            },
        },
        concurrency: Concurrency {
            group: "desktop-${{ inputs.ref || (github.event.ref_type == 'tag' && github.event.ref || github.ref_name) }}".into(),
            cancel_in_progress: true,
        },
        jobs,
    }
}

fn resolve_ref() -> Job {
    let mut env = IndexMap::new();
    env.insert("EVENT_NAME".into(), "${{ github.event_name }}".into());
    env.insert("INPUT_REF".into(), "${{ inputs.ref }}".into());
    env.insert("GITHUB_EVENT_REF".into(), "${{ github.event.ref }}".into());
    env.insert("GITHUB_EVENT_REF_TYPE".into(), "${{ github.event.ref_type }}".into());
    env.insert("SELECTED_REF".into(), "${{ github.ref }}".into());
    env.insert("SELECTED_REF_NAME".into(), "${{ github.ref_name }}".into());
    env.insert("SELECTED_REF_PROTECTED".into(), "${{ github.ref_protected }}".into());

    let mut outputs = IndexMap::new();
    outputs.insert("ref".into(), "${{ steps.resolve.outputs.ref }}".into());

    Job::Normal(NormalJob {
        cond: Some(
            "github.event_name == 'workflow_dispatch' || github.event_name == 'push' || (github.event_name == 'create' && github.event.ref_type == 'tag')".into(),
        ),
        name: "Resolve build ref".into(),
        runs_on: "ubuntu-latest".into(),
        outputs,
        steps: vec![Step {
            id: Some("resolve".into()),
            name: "Resolve ref".into(),
            run: include_str!("scripts/resolve_desktop_ref.sh").into(),
            shell: "bash".into(),
            env,
        }],
    })
}

fn calling_job(workflow_path: &str) -> Job {
    let mut with = IndexMap::new();
    with.insert("ref".into(), "${{ needs.resolve-ref.outputs.ref }}".into());

    Job::Calling(CallingJob {
        needs: vec!["resolve-ref".into()],
        uses: workflow_path.into(),
        with,
        secrets: "inherit".into(),
    })
}
