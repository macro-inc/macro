//! `Publish Android to Google Play` — manually uploads the App Bundle of a
//! published GitHub release to Google Play's internal track, or promotes a
//! version already active there to production (full rollout). The PR-driven
//! path is [`super::android_play_publish`]; this one stays for releases made
//! by hand (see docs/development/android.md).
//!
//! Google's Workload Identity provider admits only this file on main, so each
//! job runs only from `refs/heads/main`.

use gh_workflow::expr::typed::{Bool, Expr, StepHandle, StepOutput, Str, github, input};
use gh_workflow::{
    Concurrency, Event, Job, Level, Permissions, Run, Step, Use, Workflow, WorkflowDispatch,
    WorkflowInput,
};

use crate::workflows::actions::{
    ActionsCheckout, GoogleGithubActionsAuth, R0adkllUploadGooglePlay,
};
use crate::workflows::steps::{self, GOOGLE_PLAY_AUTH};
use crate::workflows::vars;

/// The Play package every release goes to.
const PACKAGE_NAME: &str = "com.macro.workspace.mobile";

struct ArtifactOutputs {
    /// The verified App Bundle's path.
    bundle: StepOutput<Str>,
    /// The verified R8 mapping's path.
    mapping: StepOutput<Str>,
}

/// The [`download_bundle`] step.
const ARTIFACT: StepHandle<ArtifactOutputs> = StepHandle::new(
    "artifact",
    ArtifactOutputs {
        bundle: StepOutput::new("artifact", "bundle"),
        mapping: StepOutput::new("artifact", "mapping"),
    },
);

/// Build the workflow.
pub fn publish_android_play() -> Workflow {
    Workflow::new("Publish Android to Google Play")
        .on(Event::default().workflow_dispatch(
            WorkflowDispatch::default()
                .add_input(
                    "operation",
                    WorkflowInput::choice(["upload-internal", "promote-production"])
                        .description(
                            "Upload a bundle to internal testing, or promote a tested version to production",
                        )
                        .default("upload-internal"),
                )
                .add_input(
                    "release_tag",
                    WorkflowInput::string()
                        .description(
                            "Internal upload only — published GitHub release containing a verified AAB",
                        )
                        .required(false),
                )
                .add_input(
                    "version_code",
                    WorkflowInput::string()
                        .description(
                            "Production promotion only — exact version code already active in internal testing (full rollout)",
                        )
                        .required(false),
                )
                .add_input(
                    "status",
                    WorkflowInput::choice(["draft", "completed"])
                        .description(
                            "Internal upload only — draft for Console review, or completed for internal testers",
                        )
                        .default("draft"),
                )
                .add_input(
                    "changes_not_sent_for_review",
                    WorkflowInput::boolean()
                        .description(
                            "Leave changes for manual submission in Play Console (only if Play requires it)",
                        )
                        .default(false),
                ),
        ))
        // All edits for this package must be serialized, even for different releases.
        .concurrency(
            Concurrency::new("google-play-com-macro-workspace-mobile").cancel_in_progress(false),
        )
        .permissions(Permissions::default().contents(Level::Read))
        .add_job("publish", publish())
        .add_job("promote", promote())
}

/// A run of `operation` from main.
fn requested(operation: &str) -> Expr<Bool> {
    github()
        .git_ref()
        .eq("refs/heads/main")
        .and(input::<Str>("operation").eq(operation))
}

/// Reading a Play token needs an OIDC token.
fn permissions() -> Permissions {
    Permissions::default()
        .contents(Level::Read)
        .id_token(Level::Write)
}

fn checkout() -> Step<Use> {
    ActionsCheckout::new("Checkout publishing workflow")
        .persist_credentials(false)
        .step()
}

fn publish() -> Job {
    Job::default()
        .name("Upload to internal testing")
        .cond(requested("upload-internal"))
        .runs_on("ubuntu-24.04")
        .timeout_minutes(30u32)
        .permissions(permissions())
        .add_env(("RELEASE_TAG", input::<Str>("release_tag")))
        .add_step(checkout())
        .add_step(check_play_configuration())
        .add_step(download_bundle())
        .add_step(
            GoogleGithubActionsAuth::new("Authenticate to Google Play")
                .workload_identity_provider(vars::GOOGLE_PLAY_WORKLOAD_IDENTITY_PROVIDER)
                .service_account(vars::GOOGLE_PLAY_SERVICE_ACCOUNT)
                .step()
                .id(GOOGLE_PLAY_AUTH.id()),
        )
        .add_step(
            R0adkllUploadGooglePlay::new("Upload to internal testing", PACKAGE_NAME)
                .service_account_json(GOOGLE_PLAY_AUTH.outputs.credentials_file_path.read())
                .release_files(ARTIFACT.outputs.bundle.read())
                .mapping_file(ARTIFACT.outputs.mapping.read())
                .release_name(input::<Str>("release_tag"))
                .tracks("internal")
                .status(input::<Str>("status"))
                .changes_not_sent_for_review(input::<Bool>("changes_not_sent_for_review"))
                .step(),
        )
        .add_step(
            Step::new("Record upload")
                .run(include_str!("scripts/android_play_record_upload.sh"))
                .add_env(("RELEASE_STATUS", input::<Str>("status"))),
        )
}

fn check_play_configuration() -> Step<Run> {
    Step::new("Check Play configuration")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            if [[ -z "$WIF_PROVIDER" || -z "$PLAY_ACCOUNT" ]]; then
              echo "Configure the Google Play repository variables; see docs/development/android.md" >&2
              exit 1
            fi
        "#})
        .add_env(("WIF_PROVIDER", vars::GOOGLE_PLAY_WORKLOAD_IDENTITY_PROVIDER))
        .add_env(("PLAY_ACCOUNT", vars::GOOGLE_PLAY_SERVICE_ACCOUNT))
}

/// Download the release's bundle and mapping and check them against the
/// release's checksums, as [`ARTIFACT`].
fn download_bundle() -> Step<Run> {
    Step::new("Download verified release bundle")
        .run(include_str!(
            "scripts/android_play_download_release_bundle.sh"
        ))
        .id(ARTIFACT.id())
        .add_env(("GH_TOKEN", github().token()))
}

fn promote() -> Job {
    Job::default()
        .name("Promote tested version to production")
        .cond(requested("promote-production"))
        .runs_on("ubuntu-24.04")
        .timeout_minutes(10u32)
        .permissions(permissions())
        .add_step(checkout())
        .add_step(
            Step::new("Check promotion inputs")
                .run(indoc::indoc! {r#"
                    set -euo pipefail
                    if [[ ! "$VERSION_CODE" =~ ^[1-9][0-9]{0,9}$ ]] || (( VERSION_CODE > 2100000000 )); then
                      echo "Enter the exact Android version code to promote (1–2100000000)" >&2
                      exit 1
                    fi
                    if [[ -z "$WIF_PROVIDER" || -z "$PLAY_ACCOUNT" ]]; then
                      echo "Configure the Google Play repository variables; see docs/development/android.md" >&2
                      exit 1
                    fi
                "#})
                .add_env(("VERSION_CODE", input::<Str>("version_code")))
                .add_env(("WIF_PROVIDER", vars::GOOGLE_PLAY_WORKLOAD_IDENTITY_PROVIDER))
                .add_env(("PLAY_ACCOUNT", vars::GOOGLE_PLAY_SERVICE_ACCOUNT)),
        )
        .add_step(steps::google_play_auth(false))
        .add_step(
            Step::new("Promote existing version to production")
                .run("node apps/web/scripts/android-play-promote.mjs")
                .add_env((
                    "GOOGLE_PLAY_ACCESS_TOKEN",
                    GOOGLE_PLAY_AUTH.outputs.access_token.read(),
                ))
                .add_env(("VERSION_CODE", input::<Str>("version_code")))
                .add_env((
                    "CHANGES_NOT_SENT_FOR_REVIEW",
                    input::<Bool>("changes_not_sent_for_review"),
                )),
        )
}
