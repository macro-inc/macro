//! `Build Agent Daemon on Tag` — self-contained `macrod` binaries for Linux
//! and macOS, attached to the release its tag names.
//!
//! Unlike everything else this repo builds, the daemon runs on a machine we
//! know nothing about: a self-hoster points it at their own checkout and their
//! own agent harness. So the Linux builds are musl-static (there is no host
//! libc to match) and the macOS builds link nothing outside the OS. Neither is
//! taken on faith — `package_agent_daemon.sh` inspects each binary and refuses
//! to package one that would reach for something that will not be there.
//!
//! Separate from [`super::build_desktop_on_tag`] on purpose. It publishes to
//! the same release off the same tag pattern, but the daemon has no business
//! waiting on DMG notarization, and a flaky desktop build has no business
//! holding it back.

use gh_workflow::{
    Concurrency, Event, Expression, Job, Push, Run, Step, Workflow, WorkflowDispatch,
    WorkflowDispatchInput,
};

use crate::workflows::{build_appimage_on_tag, runners, steps, vars};

use std::collections::HashMap;

#[cfg(test)]
mod test;

const RESOLVED_REF: &str = "${{ needs.resolve-ref.outputs.ref }}";

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

/// Build the workflow.
pub fn build_agent_daemon_on_tag() -> Workflow {
    let mut workflow = Workflow::new("Build Agent Daemon on Tag")
        .on(daemon_events())
        .concurrency(
            Concurrency::new(Expression::new(
                "agent-daemon-${{ inputs.ref || github.ref_name }}",
            ))
            .cancel_in_progress(true),
        )
        .add_job("resolve-ref", resolve_ref());

    for target in LINUX_TARGETS {
        workflow = workflow.add_job(job_id(target), linux_job(target).add_needs("resolve-ref"));
    }
    for target in MACOS_TARGETS {
        workflow = workflow.add_job(job_id(target), macos_job(target).add_needs("resolve-ref"));
    }

    let mut publish = build_appimage_on_tag::publish_job(
        RESOLVED_REF,
        xtask_paths::runtime_path!("release-artifacts/*"),
    )
    .add_needs("resolve-ref");
    for target in LINUX_TARGETS.iter().chain(MACOS_TARGETS) {
        publish = publish.add_needs(job_id(target));
    }
    // A failed platform must not prevent successful platform artifacts from
    // reaching the release.
    publish = publish.cond(Expression::new(publish_when_any_build_succeeded()));

    workflow.add_job("publish-daemon", publish)
}

fn publish_when_any_build_succeeded() -> String {
    let any_build = LINUX_TARGETS
        .iter()
        .chain(MACOS_TARGETS)
        .map(|target| format!("needs.{}.result == 'success'", job_id(target)))
        .collect::<Vec<_>>()
        .join(" || ");
    format!("!cancelled() && needs.resolve-ref.result == 'success' && ({any_build})")
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

/// Resolve the ref once, so every target job checks out the same commit even
/// if the tag moves mid-run.
fn resolve_ref() -> Job {
    Job::default()
        .name("Resolve build ref")
        .runs_on(runners::Runner::TinyNoCache.to_string())
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

/// The minimal agent-daemon Nix shell carries cargo-zigbuild, zig, and cmake
/// without realizing unrelated developer tools from the default shell.
fn linux_job(target: &DaemonTarget) -> Job {
    Job::default()
        .name(format!("Build daemon ({})", target.slug))
        .runs_on(runners::Runner::RustCi.to_string())
        .add_step(steps::checkout_ref(RESOLVED_REF))
        .add_step(steps::mount_cache_volume())
        .add_step(steps::setup_nix_with_cache())
        .add_step(steps::setup_dev_shell_named("agent-daemon"))
        // The dev shell points RUSTC_WRAPPER at sccache regardless; this aims
        // it at the shared remote cache so a release build is not a cold
        // compile of the whole dependency graph. It degrades to the local
        // cache on failure, so it is never load-bearing.
        .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
        .add_step(steps::derive_artifact_metadata(RESOLVED_REF))
        .add_step(
            Step::new("Build daemon")
                .run(include_str!("scripts/build_agent_daemon_linux.sh"))
                .shell("bash")
                .add_env(("TARGET", target.triple)),
        )
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
        .add_step(steps::checkout_ref(RESOLVED_REF))
        .add_step(steps::setup_rust_light())
        .add_step(steps::derive_artifact_metadata(RESOLVED_REF))
        .add_step(
            Step::new("Build daemon")
                .run(include_str!("scripts/build_agent_daemon_macos.sh"))
                .shell("bash")
                .add_env(("TARGET", target.triple)),
        )
        .add_step(package_step(target))
        .add_step(upload_step(target))
}

fn package_step(target: &DaemonTarget) -> Step<Run> {
    Step::new("Package daemon")
        .run(include_str!("scripts/package_agent_daemon.sh"))
        .shell("bash")
        .add_env(("TARGET", target.triple))
        .add_env(("SLUG", target.slug))
        .add_env(("SAFE_TAG", "${{ steps.metadata.outputs.safe_tag }}"))
        .add_env(("SMOKE_RUN", if target.smoke_run { "1" } else { "0" }))
}

fn upload_step(target: &DaemonTarget) -> Step<gh_workflow::Use> {
    steps::upload_artifact(
        &format!(
            "macrod-{}-${{{{ steps.metadata.outputs.safe_tag }}}}",
            target.slug
        ),
        xtask_paths::runtime_path!("artifacts/*"),
    )
}
