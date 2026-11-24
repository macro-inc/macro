//! `Build Agent Daemon on Tag` — self-contained `macrod` binaries for Linux,
//! macOS, and Windows, attached to the release its tag names.
//!
//! Unlike everything else this repo builds, the daemon runs on a machine we
//! know nothing about: a self-hoster points it at their own checkout and their
//! own agent harness. So the Linux builds are musl-static (there is no host
//! libc to match), and the macOS and Windows builds link nothing outside the
//! OS. None of that is taken on faith — `package_agent_daemon.sh` inspects each binary and refuses
//! to package one that would reach for something that will not be there.
//!
//! Separate from [`super::build_desktop_on_tag`] on purpose. It publishes to
//! the same release off the same tag pattern, but the daemon has no business
//! waiting on DMG notarization, and a flaky desktop build has no business
//! holding it back.

use gh_workflow::expr::typed::{
    Bool, Expr, JobHandle, JobOutput, StepHandle, StepOutput, Str, cancelled, github, input, needs,
};
use gh_workflow::{
    Concurrency, Event, Job, Push, Run, Step, Workflow, WorkflowDispatch, WorkflowInput,
};

use crate::workflows::{build_appimage_on_tag, runners, steps, vars};

#[cfg(test)]
mod test;

struct ResolveRefOutputs {
    /// The resolved ref, so every build job checks out the same commit.
    git_ref: JobOutput<Str>,
}

/// The `resolve-ref` job.
const RESOLVE_REF: JobHandle<ResolveRefOutputs> = JobHandle::new(
    "resolve-ref",
    ResolveRefOutputs {
        git_ref: JobOutput::new("resolve-ref", "ref"),
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

fn resolved_ref() -> Expr<Str> {
    RESOLVE_REF.outputs.git_ref.read()
}

/// One published binary.
struct DaemonTarget {
    /// Rust target triple to build.
    triple: &'static str,
    /// Job id suffix and artifact name suffix — what a user reads off the
    /// release page to pick their download.
    slug: &'static str,
    /// Whether this runner can execute what it just built. The cross-built
    /// slices can only be inspected, not run.
    smoke_run: bool,
}

/// musl-static, built through cargo-zigbuild so the C in the graph
/// (aws-lc-sys) gets a compiler that targets musl.
const LINUX_TARGETS: &[DaemonTarget] = &[
    DaemonTarget {
        triple: "x86_64-unknown-linux-musl",
        slug: "linux-x86_64",
        smoke_run: true,
    },
    DaemonTarget {
        triple: "aarch64-unknown-linux-musl",
        slug: "linux-aarch64",
        smoke_run: false,
    },
];

/// Built on the Apple Silicon runner; the Intel slice is a cross-compile
/// against the same SDK, so it builds here but cannot be run here.
const MACOS_TARGETS: &[DaemonTarget] = &[
    DaemonTarget {
        triple: "aarch64-apple-darwin",
        slug: "macos-aarch64",
        smoke_run: true,
    },
    DaemonTarget {
        triple: "x86_64-apple-darwin",
        slug: "macos-x86_64",
        smoke_run: false,
    },
];

/// Built natively with MSVC: a cross-compile cannot link against the Windows
/// SDK import libraries, and this runner can smoke-run what it builds.
const WINDOWS_TARGETS: &[DaemonTarget] = &[DaemonTarget {
    triple: "x86_64-pc-windows-msvc",
    slug: "windows-x86_64",
    smoke_run: true,
}];

fn all_targets() -> impl Iterator<Item = &'static DaemonTarget> {
    LINUX_TARGETS
        .iter()
        .chain(MACOS_TARGETS)
        .chain(WINDOWS_TARGETS)
}

/// Build the workflow.
pub fn build_agent_daemon_on_tag() -> Workflow {
    let mut workflow = Workflow::new("Build Agent Daemon on Tag")
        .on(daemon_events())
        .concurrency(
            Concurrency::new(format!(
                "agent-daemon-{}",
                input::<Str>("ref").or_else(github().ref_name())
            ))
            .cancel_in_progress(true),
        )
        .add_job(RESOLVE_REF, resolve_ref());

    for target in LINUX_TARGETS {
        workflow = workflow.add_job(job_id(target), linux_job(target).add_needs(RESOLVE_REF));
    }
    for target in MACOS_TARGETS {
        workflow = workflow.add_job(job_id(target), macos_job(target).add_needs(RESOLVE_REF));
    }
    for target in WINDOWS_TARGETS {
        workflow = workflow.add_job(job_id(target), windows_job(target).add_needs(RESOLVE_REF));
    }

    let mut publish = build_appimage_on_tag::publish_job(
        resolved_ref(),
        xtask_paths::runtime_path!("release-artifacts/*"),
        None,
    )
    .add_needs(RESOLVE_REF);
    for target in all_targets() {
        publish = publish.add_needs(job_id(target));
    }
    // A failed platform must not prevent successful platform artifacts from
    // reaching the release.
    publish = publish.cond(publish_when_any_build_succeeded());

    workflow.add_job("publish-daemon", publish)
}

fn publish_when_any_build_succeeded() -> Expr<Bool> {
    let any_build = all_targets()
        .map(|target| needs(&job_id(target)).result().eq("success"))
        .reduce(Expr::or)
        .expect("at least one daemon target");
    (!cancelled())
        .and(RESOLVE_REF.result().eq("success"))
        .and(any_build)
}

fn job_id(target: &DaemonTarget) -> String {
    format!("build-daemon-{}", target.slug.replace('_', "-"))
}

fn daemon_events() -> Event {
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

/// Resolve the ref once, so every target job checks out the same commit even
/// if the tag moves mid-run.
fn resolve_ref() -> Job {
    Job::default()
        .name("Resolve build ref")
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .add_output(
            RESOLVE_REF.outputs.git_ref.name(),
            RESOLVE.outputs.git_ref.read(),
        )
        .add_step(resolve_ref_step())
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

/// The minimal agent-daemon Nix shell carries cargo-zigbuild, zig, and cmake
/// without realizing unrelated developer tools from the default shell.
fn linux_job(target: &DaemonTarget) -> Job {
    Job::default()
        .name(format!("Build daemon ({})", target.slug))
        .runs_on(runners::Runner::RustCi.to_string())
        .add_step(steps::checkout_ref(resolved_ref()))
        .add_step(steps::mount_cache_volume())
        .add_step(steps::setup_nix_with_cache())
        .add_step(steps::setup_dev_shell_named("agent-daemon"))
        // The dev shell points RUSTC_WRAPPER at sccache regardless; this aims
        // it at the shared remote cache so a release build is not a cold
        // compile of the whole dependency graph. It degrades to the local
        // cache on failure, so it is never load-bearing.
        .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
        .add_step(steps::derive_artifact_metadata(resolved_ref()))
        .add_step(build_step(
            target,
            include_str!("scripts/build_agent_daemon_linux.sh"),
        ))
        .add_step(package_step(target))
        .add_step(upload_step(target))
        .add_step(steps::teardown_nix())
}

/// Apple Silicon, because linking Mach-O needs an Apple SDK and Apple licenses
/// one only on Apple hardware.
fn macos_job(target: &DaemonTarget) -> Job {
    Job::default()
        .name(format!("Build daemon ({})", target.slug))
        .runs_on(runners::Runner::MacOsArm.to_string())
        .add_step(steps::checkout_ref(resolved_ref()))
        .add_step(steps::setup_rust_light())
        .add_step(steps::derive_artifact_metadata(resolved_ref()))
        .add_step(build_step(
            target,
            include_str!("scripts/build_agent_daemon_macos.sh"),
        ))
        .add_step(package_step(target))
        .add_step(upload_step(target))
}

/// The runner's own Visual Studio toolchain links the binary; the build
/// script makes it independent of the Visual C++ redistributable.
fn windows_job(target: &DaemonTarget) -> Job {
    Job::default()
        .name(format!("Build daemon ({})", target.slug))
        .runs_on(runners::Runner::Windows.to_string())
        .add_step(steps::checkout_ref(resolved_ref()))
        .add_step(steps::setup_rust_light())
        .add_step(steps::derive_artifact_metadata(resolved_ref()))
        .add_step(build_step(
            target,
            include_str!("scripts/build_agent_daemon_windows.sh"),
        ))
        .add_step(package_step(target))
        .add_step(upload_step(target))
}

/// The release tag is compiled in: `macrod --version` prints it and the
/// self-updater compares it with the latest release.
fn build_step(target: &DaemonTarget, script: &str) -> Step<Run> {
    Step::new("Build daemon")
        .run(script)
        .shell("bash")
        .add_env(("TARGET", target.triple))
        .add_env((
            "MACROD_RELEASE_TAG",
            steps::ARTIFACT_METADATA.outputs.tag.read(),
        ))
}

fn package_step(target: &DaemonTarget) -> Step<Run> {
    Step::new("Package daemon")
        .run(include_str!("scripts/package_agent_daemon.sh"))
        .shell("bash")
        .add_env(("TARGET", target.triple))
        .add_env(("SLUG", target.slug))
        .add_env(("SAFE_TAG", steps::ARTIFACT_METADATA.outputs.safe_tag.read()))
        .add_env(("RELEASE_TAG", steps::ARTIFACT_METADATA.outputs.tag.read()))
        .add_env(("SMOKE_RUN", if target.smoke_run { "1" } else { "0" }))
}

fn upload_step(target: &DaemonTarget) -> Step<gh_workflow::Use> {
    steps::upload_artifact(
        &format!(
            "macrod-{}-{}",
            target.slug,
            steps::ARTIFACT_METADATA.outputs.safe_tag.read()
        ),
        xtask_paths::runtime_path!("artifacts/*"),
    )
}
