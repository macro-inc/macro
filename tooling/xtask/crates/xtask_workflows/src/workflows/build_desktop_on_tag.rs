//! `Build Desktop on Tag` — orchestrator workflow that triggers the AppImage,
//! the Apple silicon and Intel DMG, and the Windows installer builds in
//! parallel when a release tag is pushed. Also supports manual dispatch.
//! Generated into `build_desktop_on_tag.yml`.
//!
//! The Intel DMG is optional: it runs only once the tag pins its CEF codec
//! build (`scripts/decide_intel_desktop.sh`), and when it fails or is skipped
//! the other builds still publish, without `darwin-x86_64` in the feed.
//!
//! The reusable job definitions live in [`super::build_appimage_on_tag`],
//! [`super::build_dmg_on_tag`] and [`super::desktop_windows`]. Apple silicon
//! and Linux must both build for a release; Windows joins it only when its
//! build succeeds, the installed app launches, and it may be published. The
//! macOS release QA job comes from [`super::desktop_qa_macos`]; promotion to
//! `desktop-stable` waits for it.

use gh_workflow::expr::typed::{
    Bool, Expr, Flag, JobHandle, JobOutput, StepHandle, StepOutput, Str, cancelled, github, input,
};
use gh_workflow::{
    Concurrency, Event, Job, Level, Permissions, Push, Run, Step, Workflow, WorkflowDispatch,
    WorkflowInput,
};

use crate::workflows::build_dmg_on_tag::MacArch;
use crate::workflows::{
    build_appimage_on_tag, build_dmg_on_tag, desktop_qa_macos, desktop_windows, steps, vars,
};

#[cfg(test)]
mod test;

/// The ref `resolve-ref` resolved, so every build job checks out the same commit.
struct ResolveRefOutputs {
    /// The git ref every build and publish job checks out.
    git_ref: JobOutput<Str>,
    /// Whether this run builds the Intel Mac app.
    intel: JobOutput<Flag>,
}

/// The `resolve-ref` job.
const RESOLVE_REF: JobHandle<ResolveRefOutputs> = JobHandle::new(
    "resolve-ref",
    ResolveRefOutputs {
        git_ref: JobOutput::new("resolve-ref", "ref"),
        intel: JobOutput::new("resolve-ref", "intel"),
    },
);

struct ResolveOutputs {
    /// The resolved ref, behind `RESOLVE_REF.outputs.git_ref`.
    git_ref: StepOutput<Str>,
}

/// The [`resolve_ref_step`] step.
const RESOLVE: StepHandle<ResolveOutputs> = StepHandle::new(
    "resolve",
    ResolveOutputs {
        git_ref: StepOutput::new("resolve", "ref"),
    },
);

struct DecideIntelOutputs {
    /// `true` when this run builds the Intel Mac app.
    intel: StepOutput<Flag>,
}

/// The [`decide_intel_step`] step.
const DECIDE_INTEL: StepHandle<DecideIntelOutputs> = StepHandle::new(
    "intel",
    DecideIntelOutputs {
        intel: StepOutput::new("intel", "intel"),
    },
);

/// Room for both notarizations on top of a build that takes about two hours,
/// while the installers it holds still land before `Desktop Release Watch`
/// looks for them (`DEADLINE_HOURS`, four). Apple silicon's job, which every
/// release needs, keeps GitHub's default.
const INTEL_DMG_TIMEOUT_MINUTES: u32 = 180;

/// The builds' artifacts (`macro-appimage-*`, `macro-dmg-*`, and
/// `macro-windows-*` when Windows may be published). The publish jobs attach
/// every artifact they download to the release, so they download only these,
/// never the Windows frontend, an unpublished installer or the QA results.
const BUILD_ARTIFACT_PATTERN: &str = "macro-*";

/// The job that attaches the installers to the release.
const PUBLISH_INSTALLERS: JobHandle<()> = JobHandle::new("publish-installers", ());

fn resolved_ref() -> Expr<Str> {
    RESOLVE_REF.outputs.git_ref.read()
}

/// The dispatch override, else the pushed tag, else the selected ref.
fn desktop_ref() -> Expr<Str> {
    let event_ref = github()
        .event::<Str>("ref_type")
        .eq("tag")
        .then_else(github().event::<Str>("ref"), github().ref_name());
    input::<Str>("ref").or_else(event_ref)
}

/// Build the workflow.
pub fn build_desktop_on_tag() -> Workflow {
    Workflow::new("Build Desktop on Tag")
        .on(desktop_events())
        .concurrency(
            Concurrency::new(format!("desktop-{}", desktop_ref())).cancel_in_progress(true),
        )
        .add_job(RESOLVE_REF, resolve_ref())
        .add_job(
            build_appimage_on_tag::BUILD_APPIMAGE,
            build_appimage_on_tag::build_appimage_job(resolved_ref()).add_needs(RESOLVE_REF),
        )
        .add_job(
            build_dmg_on_tag::BUILD_DMG,
            build_dmg_on_tag::build_dmg_job(resolved_ref(), MacArch::Aarch64)
                .add_needs(RESOLVE_REF),
        )
        .add_job(
            build_dmg_on_tag::BUILD_DMG_X86_64,
            build_dmg_on_tag::build_dmg_job(resolved_ref(), MacArch::X86_64)
                .add_needs(RESOLVE_REF)
                .cond(RESOLVE_REF.outputs.intel.read().is_set())
                // The installers wait for this job, so a stuck Intel build
                // must not hold Apple silicon and Linux for GitHub's six hours.
                .timeout_minutes(INTEL_DMG_TIMEOUT_MINUTES),
        )
        .add_job(
            desktop_windows::WINDOWS_FRONTEND,
            desktop_windows::frontend_job(resolved_ref(), desktop_windows::Purpose::Release)
                .add_needs(RESOLVE_REF),
        )
        .add_job(
            desktop_windows::BUILD_WINDOWS,
            desktop_windows::windows_job(resolved_ref(), desktop_windows::Purpose::Release)
                .add_needs(RESOLVE_REF)
                .add_needs(desktop_windows::WINDOWS_FRONTEND),
        )
        .add_job(
            desktop_windows::LAUNCH_WINDOWS,
            desktop_windows::launch_job(resolved_ref(), desktop_windows::Purpose::Release)
                .add_needs(RESOLVE_REF)
                .add_needs(desktop_windows::BUILD_WINDOWS),
        )
        // The installers users download must reach the release on their own.
        // Updater signing needs Doppler, Apple, and the stable channel; none of
        // that may stand between a green build and macro.com/download.
        .add_job(
            PUBLISH_INSTALLERS,
            build_appimage_on_tag::publish_job(
                resolved_ref(),
                xtask_paths::runtime_path!("release-artifacts/*"),
                Some(BUILD_ARTIFACT_PATTERN),
            )
            .name("Publish desktop installers")
            .add_needs(RESOLVE_REF)
            .add_needs(build_appimage_on_tag::BUILD_APPIMAGE)
            .add_needs(build_dmg_on_tag::BUILD_DMG)
            // Waits for the Intel build and the Windows launch so their
            // installers land too, but publishes without them when they fail
            // or are skipped.
            .add_needs(build_dmg_on_tag::BUILD_DMG_X86_64)
            .add_needs(desktop_windows::LAUNCH_WINDOWS)
            .cond(all_succeeded([
                RESOLVE_REF.result(),
                build_appimage_on_tag::BUILD_APPIMAGE.result(),
                build_dmg_on_tag::BUILD_DMG.result(),
            ])),
        )
        // The signed DMG must launch and pass QA before any installed app is
        // offered it. Installers still reach the versioned release without it.
        .add_job(
            desktop_qa_macos::QA_RELEASE,
            desktop_qa_macos::qa_release_job(resolved_ref())
                .add_needs(RESOLVE_REF)
                .add_needs(build_dmg_on_tag::BUILD_DMG),
        )
        .add_job(
            "publish-release",
            publish_desktop_job()
                .add_needs(RESOLVE_REF)
                .add_needs(PUBLISH_INSTALLERS)
                .add_needs(desktop_qa_macos::QA_RELEASE),
        )
}

/// `!cancelled()` and every one of these `needs.<job>.result` is `success`.
/// A job after one that tolerates a failed or skipped need must say so: the
/// default `success()` skips it whenever any earlier job in the chain did not
/// succeed.
fn all_succeeded(results: impl IntoIterator<Item = Expr<Str>>) -> Expr<Bool> {
    results
        .into_iter()
        .fold(!cancelled(), |all, result| all.and(result.eq("success")))
}

fn publish_desktop_job() -> Job {
    Job::default()
        .name("Sign and publish desktop updates")
        .runs_on("ubuntu-latest")
        // Serialize channel promotion across tags; an older build cannot win a race.
        .concurrency(Concurrency::new("desktop-stable-publish").cancel_in_progress(false))
        // A wedged signer must not hold the channel lock, and must not sit long
        // enough for the runner to be reaped with its logs still unuploaded.
        .timeout_minutes(20u32)
        .cond(
            // The QA of the Apple silicon DMG gates promotion; Intel has none.
            all_succeeded([
                PUBLISH_INSTALLERS.result(),
                desktop_qa_macos::QA_RELEASE.result(),
            ])
            .and(resolved_ref().starts_with("refs/tags/v")),
        )
        .permissions(Permissions {
            contents: Some(Level::Write),
            ..Default::default()
        })
        .add_step(steps::checkout_ref(resolved_ref()))
        .add_step(steps::setup_nix())
        .add_step(steps::derive_artifact_metadata(resolved_ref()))
        .add_step(steps::download_artifacts(
            xtask_paths::runtime_path!("release-artifacts"),
            Some(BUILD_ARTIFACT_PATTERN),
        ))
        .add_step(
            Step::new("Sign updater artifacts")
                .run(include_str!("scripts/sign_desktop_updates.sh"))
                .shell("bash")
                .add_env(("DOPPLER_TOKEN", vars::MACOS_RELEASE_DOPPLER_TOKEN))
                .add_env(("GH_TOKEN", github().token()))
                .add_env(("RELEASE_TAG", steps::ARTIFACT_METADATA.outputs.tag.read()))
                .add_env(("RELEASE_REPOSITORY", github().repository())),
        )
        .add_step(
            Step::new("Publish desktop release and update feed")
                .run(include_str!("scripts/publish_desktop_updates.sh"))
                .shell("bash")
                .add_env(("GH_TOKEN", github().token()))
                .add_env(("RELEASE_TAG", steps::ARTIFACT_METADATA.outputs.tag.read()))
                .add_env(("RELEASE_REPOSITORY", github().repository())),
        )
        .add_step(
            Step::new("Publish stable download links")
                .run(include_str!("scripts/publish_desktop_download_links.sh"))
                .shell("bash")
                .add_env(("GH_TOKEN", github().token()))
                .add_env(("RELEASE_REPOSITORY", github().repository())),
        )
    // No Teardown Nix here. This job runs on a hosted runner with no /nix cache
    // volume to unmount, where the teardown's `fuser -km /nix` kills the runner
    // process itself — the job dies with "lost communication with the server"
    // and its logs are never uploaded.
}

fn desktop_events() -> Event {
    Event::default()
        .push(Push::default().add_tag(build_appimage_on_tag::DESKTOP_TAG_PATTERN))
        .workflow_dispatch(workflow_dispatch())
}

fn workflow_dispatch() -> WorkflowDispatch {
    WorkflowDispatch::default().add_input(
        "ref",
        WorkflowInput::string().description(
            "Optional release tag override (v* or refs/tags/v*). Leave empty to build the branch or tag selected for this workflow run.",
        ),
    )
}

fn resolve_ref() -> Job {
    Job::default()
        .cond(
            github()
                .event_name()
                .eq("workflow_dispatch")
                .or(github().event_name().eq("push"))
                .or(github()
                    .event_name()
                    .eq("create")
                    .and(github().event::<Str>("ref_type").eq("tag"))),
        )
        .name("Resolve build ref")
        .runs_on("ubuntu-latest")
        .add_output(
            RESOLVE_REF.outputs.git_ref.name(),
            RESOLVE.outputs.git_ref.read(),
        )
        .add_output(
            RESOLVE_REF.outputs.intel.name(),
            DECIDE_INTEL.outputs.intel.read(),
        )
        .add_step(resolve_ref_step())
        .add_step(decide_intel_step())
}

fn decide_intel_step() -> Step<Run> {
    Step::new("Decide Intel Mac build")
        .run(include_str!("scripts/decide_intel_desktop.sh"))
        .id(DECIDE_INTEL.id())
        .shell("bash")
        .add_env(("BUILD_REF", RESOLVE.outputs.git_ref.read()))
        .add_env(("GH_TOKEN", github().token()))
}

fn resolve_ref_step() -> Step<Run> {
    Step::new("Resolve ref")
        .run(include_str!("scripts/resolve_desktop_ref.sh"))
        .id(RESOLVE.id())
        .shell("bash")
        .add_env(("EVENT_NAME", github().event_name()))
        .add_env(("INPUT_REF", input::<Str>("ref")))
        .add_env(("GITHUB_EVENT_REF", github().event::<Str>("ref")))
        .add_env(("GITHUB_EVENT_REF_TYPE", github().event::<Str>("ref_type")))
        .add_env(("SELECTED_REF", github().git_ref()))
}
