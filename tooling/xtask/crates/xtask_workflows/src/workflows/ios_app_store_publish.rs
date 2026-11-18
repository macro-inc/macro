//! `iOS App Store Publish` — releases the committed iOS version on the App
//! Store. [`super::ios_app_store_release`] submits versions with release type
//! "manual", so Apple's approval holds them in Pending Developer Release
//! until this runs. `release-production` calls it once the web deploy that
//! ships the matching bundle has succeeded, without making the deploy wait
//! on it.
//!
//! `ios-app-store.mjs publish` releases only the version + build committed at
//! the deployed commit, and only from that held state: a version approved
//! for a PR that has not merged yet stays held, and an already-live version
//! is left alone. To retry a failed release, re-run the failed job in the
//! `Deploy Production Release` run, which keeps its release tag. A manual
//! dispatch must also run from that tag: from a branch (`main` by default)
//! the committed version may be another native PR's, held for a deploy that
//! hasn't happened, so the run refuses a branch.

use std::collections::HashMap;

use gh_workflow::{
    Event, Job, Level, Permissions, Run, Step, Use, Workflow, WorkflowCall, WorkflowCallSecret,
    WorkflowDispatch,
};

use crate::workflows::{runners, steps, vars};

/// Build the workflow.
pub fn ios_app_store_publish() -> Workflow {
    Workflow::new("iOS App Store Publish")
        .on(Event::default()
            .workflow_call(WorkflowCall::default().secrets(HashMap::from([(
                "IOS_RELEASE_DOPPLER_TOKEN".to_string(),
                WorkflowCallSecret {
                    description: "Doppler service token for ios-release/prd".into(),
                    required: true,
                },
            )])))
            .workflow_dispatch(WorkflowDispatch::default()))
        .add_job("publish", publish_job())
}

fn publish_job() -> Job {
    Job::default()
        .name("Release the approved iOS version on the App Store")
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .timeout_minutes(10u32)
        .permissions(Permissions::default().contents(Level::Read))
        .add_step(require_release_tag())
        .add_step(steps::checkout(false, false))
        .add_step(setup_bun())
        .add_step(fetch_credentials())
        .add_step(publish())
}

/// A called run inherits the prod deploy's release tag; a dispatched one runs
/// at whatever ref was picked (see the module docs).
fn require_release_tag() -> Step<Run> {
    Step::new("Require a release tag")
        .run(indoc::indoc! {r#"
            if [[ "$GITHUB_REF_TYPE" != "tag" ]]; then
              echo "Run this from the deployed release tag (\"Use workflow from\": the tag), not ${GITHUB_REF_NAME}:" \
                "a branch can commit another PR's held version whose web bundle has not deployed." \
                "To retry a failed publish, re-run the failed job in the Deploy Production Release run." >&2
              exit 1
            fi
        "#})
        .shell("bash")
}

fn setup_bun() -> Step<Use> {
    Step::new("Setup Bun")
        .uses(
            "oven-sh",
            "setup-bun",
            "0c5077e51419868618aeaa5fe8019c62421857d6",
        ) // v2.2.0
        .add_with(("bun-version", "1.3.13"))
}

fn fetch_credentials() -> Step<Run> {
    Step::new("Fetch App Store Connect credentials from Doppler")
        .run(include_str!("scripts/ios_app_store_connect_credentials.sh"))
        .shell("bash")
        .add_env(("DOPPLER_TOKEN", vars::IOS_RELEASE_DOPPLER_TOKEN))
}

fn publish() -> Step<Run> {
    Step::new("Release the committed version if Apple approved it")
        .run("bun scripts/ios-app-store.mjs publish")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}
