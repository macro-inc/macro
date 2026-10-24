//! `Build Desktop on Tag` — orchestrator workflow that triggers AppImage and DMG
//! builds in parallel when a release tag is pushed. Pull requests that change
//! the desktop build run the same jobs without signing or publishing, and main
//! builds nightly so failures from outside the repository (runner images,
//! Apple services, credentials) surface before a release does. Also supports
//! manual dispatch. Generated into `build_desktop_on_tag.yml`.
//!
//! The reusable job definitions live in [`super::build_appimage_on_tag`] and
//! [`super::build_dmg_on_tag`].

use std::collections::{BTreeSet, HashMap};

use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, PullRequest, Push, Run, Step,
    Workflow, WorkflowDispatch, WorkflowDispatchInput,
};

use crate::workflows::build_appimage_on_tag::{self, DESKTOP_HOSTED_RUNNER, NOT_PULL_REQUEST};
use crate::workflows::{build_dmg_on_tag, runners, steps, vars};

#[cfg(test)]
mod test;

const RESOLVED_REF: &str = "${{ needs.resolve-ref.outputs.ref }}";

/// 09:17 UTC, ahead of the US workday's first release.
const NIGHTLY_CRON: &str = "17 9 * * *";

/// Render the workflow plus a job that checks every secret its jobs read.
pub fn render() -> anyhow::Result<String> {
    let workflow = build_desktop_on_tag();
    let yaml = workflow.to_string().map_err(|e| anyhow::anyhow!("{e:?}"))?;
    workflow
        .add_job(
            "check-release-secrets",
            check_release_secrets(&secrets_read_by(&yaml)),
        )
        .to_string()
        .map_err(|e| anyhow::anyhow!("{e:?}"))
}

fn build_desktop_on_tag() -> Workflow {
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
        // The installers users download must reach the release on their own.
        // Updater signing needs Doppler, Apple, and the stable channel; none of
        // that may stand between a green build and macro.com/download.
        .add_job(
            "publish-installers",
            build_appimage_on_tag::publish_job(
                RESOLVED_REF,
                xtask_paths::runtime_path!("release-artifacts/*"),
            )
            .name("Publish desktop installers")
            .cond(Expression::new(NOT_PULL_REQUEST))
            .add_needs("resolve-ref")
            .add_needs("build-appimage")
            .add_needs("build-dmg"),
        )
        .add_job(
            "publish-release",
            publish_desktop_job()
                .add_needs("resolve-ref")
                .add_needs("publish-installers"),
        )
}

/// Every `secrets.NAME` the rendered jobs read.
fn secrets_read_by(yaml: &str) -> BTreeSet<&str> {
    yaml.split("secrets.")
        .skip(1)
        .map(|rest| {
            let end = rest
                .find(|c: char| !(c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_'))
                .unwrap_or(rest.len());
            &rest[..end]
        })
        .filter(|name| !name.is_empty())
        .collect()
}

/// A secret is configured in the repository settings, outside any diff, so a
/// change that starts reading a new one can merge green and fail the next
/// release. Running this on pull requests fails that change instead.
fn check_release_secrets(names: &BTreeSet<&str>) -> Job {
    let step = names.iter().fold(
        Step::new("Check release secrets are configured")
            .run(include_str!("scripts/check_release_secrets.sh"))
            .shell("bash")
            .add_env((
                "RELEASE_SECRETS",
                names.iter().copied().collect::<Vec<_>>().join(" "),
            )),
        |step, name| step.add_env((*name, format!("${{{{ secrets.{name} }}}}"))),
    );
    Job::default()
        .name("Check release secrets")
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .timeout_minutes(5u32)
        .add_needs("resolve-ref")
        .add_step(step)
}

fn publish_desktop_job() -> Job {
    Job::default()
        .name("Sign and publish desktop updates")
        .runs_on(DESKTOP_HOSTED_RUNNER)
        // Serialize channel promotion across tags; an older build cannot win a race.
        .concurrency(
            Concurrency::new(Expression::new("desktop-stable-publish")).cancel_in_progress(false),
        )
        // A wedged signer must not hold the channel lock, and must not sit long
        // enough for the runner to be reaped with its logs still unuploaded.
        .timeout_minutes(20u32)
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
    // No Teardown Nix here. This job runs on a hosted runner with no /nix cache
    // volume to unmount, where the teardown's `fuser -km /nix` kills the runner
    // process itself — the job dies with "lost communication with the server"
    // and its logs are never uploaded.
}

fn desktop_events() -> Event {
    Event::default()
        .push(Push::default().add_tag(build_appimage_on_tag::DESKTOP_TAG_PATTERN))
        .pull_request(desktop_pull_request())
        .add_cron_schedule(NIGHTLY_CRON)
        .workflow_dispatch(workflow_dispatch())
}

/// Desktop-specific build inputs that no other pull request check builds. The
/// desktop app also bundles the frontend and the root workspace's `macrod`;
/// those are covered by the web and Rust checks, and the nightly build catches
/// what only breaks in the desktop packaging of them.
fn desktop_pull_request() -> PullRequest {
    PullRequest::default()
        .add_branch("main")
        .add_path(xtask_paths::repo_glob!("apps/web/tauri/**"))
        .add_path(xtask_paths::repo_glob!(
            "apps/web/scripts/desktop-release.mjs"
        ))
        .add_path(xtask_paths::repo_glob!("nix/tauri-desktop.nix"))
        .add_path(xtask_paths::repo_glob!("nix/dmg-layout.py"))
        .add_path(xtask_paths::repo_glob!("nix/appimage/**"))
        .add_path(xtask_paths::repo_glob!("nix-support/**"))
        .add_path(xtask_paths::repo_glob!("flake.nix"))
        .add_path(xtask_paths::repo_glob!("flake.lock"))
        .add_path(xtask_paths::repo_glob!("rust-toolchain.toml"))
        .add_path(xtask_paths::repo_glob!(".github/actions/setup-nix/**"))
        .add_path(xtask_paths::repo_glob!(".github/actions/teardown-nix/**"))
        .add_path(xtask_paths::repo_glob!(
            ".github/workflows/build_desktop_on_tag.yml"
        ))
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
        // Fork and Dependabot pull requests get no secrets, so they could not
        // build the bundle.
        .cond(Expression::new(
            "github.event_name == 'workflow_dispatch' || github.event_name == 'push' || github.event_name == 'schedule' || (github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && github.actor != 'dependabot[bot]') || (github.event_name == 'create' && github.event.ref_type == 'tag')",
        ))
        .name("Resolve build ref")
        .runs_on(DESKTOP_HOSTED_RUNNER)
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
