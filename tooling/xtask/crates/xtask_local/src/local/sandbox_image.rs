//! Ensure the local agent-harness sandbox image exists before compose starts
//! the harness.
//!
//! `run_local` / `stack up` skip the build when the tag is already on the
//! daemon. Otherwise they pull GHCR `:latest` (the image `main` publishes) and
//! retag it, and only build `crates/agent_harness/container` if that pull
//! fails. A missing GHCR image must not fail the stack.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::{Command, Stdio};

use anyhow::Result;

use super::stage::Stage;

#[cfg(test)]
mod test;

/// Local Docker tag `just run_local` / Fly previews load. Keep in sync with
/// `xtask_workflows::workflows::vars::AGENT_HARNESS_LOCAL_IMAGE`.
pub const DEFAULT_LOCAL_TAG: &str = "macro-agent-harness:latest";

/// GHCR repository `main` publishes. Keep in sync with
/// `xtask_workflows::workflows::vars::AGENT_HARNESS_GHCR_IMAGE`.
pub const GHCR_IMAGE: &str = "ghcr.io/macro-inc/macro-agent-harness";

/// GHCR tag local stacks pull when the daemon does not already have the image.
pub const GHCR_LATEST: &str = "ghcr.io/macro-inc/macro-agent-harness:latest";

/// Build context matching `just -f crates/agent_harness/justfile build-local`.
pub const CONTEXT_REL: &str = "crates/agent_harness/container";

/// What [`ensure`] will do for a resolved env, before talking to Docker.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct EnsurePlan {
    /// Tag the harness is configured to run.
    pub tag: String,
    /// Whether a miss should try GHCR `:latest` before building.
    pub pull_ghcr: bool,
}

impl EnsurePlan {
    /// `None` when local containers are off, so stack-up skips this entirely.
    pub fn from_env(env: &BTreeMap<String, String>) -> Option<Self> {
        if env
            .get("DEV_DANGEROUS_LOCAL_CONTAINERS")
            .map(String::as_str)
            != Some("true")
        {
            return None;
        }
        let tag = env
            .get("LOCAL_CONTAINER_IMAGE")
            .map(String::as_str)
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_LOCAL_TAG)
            .to_owned();
        Some(Self {
            pull_ghcr: tag == DEFAULT_LOCAL_TAG,
            tag,
        })
    }
}

pub(crate) fn image_inspect_args(image: &str) -> Vec<String> {
    vec!["image".to_owned(), "inspect".to_owned(), image.to_owned()]
}

pub(crate) fn pull_args(image: &str) -> Vec<String> {
    vec!["pull".to_owned(), image.to_owned()]
}

pub(crate) fn tag_args(source: &str, dest: &str) -> Vec<String> {
    vec!["tag".to_owned(), source.to_owned(), dest.to_owned()]
}

pub(crate) fn build_args(tag: &str, context: &Path) -> Vec<String> {
    vec![
        "build".to_owned(),
        "--tag".to_owned(),
        tag.to_owned(),
        context.display().to_string(),
    ]
}

/// Pull GHCR latest, retag, or build, when local sandboxes are on.
///
/// Dry-run notes the plan and does not invoke Docker. A GHCR miss falls
/// through to `docker build` instead of failing the stack.
pub fn ensure(stage: &Stage, env: &BTreeMap<String, String>) -> Result<()> {
    let Some(plan) = EnsurePlan::from_env(env) else {
        return Ok(());
    };
    if stage.is_dry_run() {
        stage.note(&format!("sandbox image: would ensure {}", plan.tag));
        return Ok(());
    }
    if docker_succeeds(&image_inspect_args(&plan.tag)) {
        stage.note(&format!("sandbox image {} already present", plan.tag));
        return Ok(());
    }
    if plan.pull_ghcr && pull_and_retag() {
        stage.note(&format!(
            "sandbox image {} pulled from {GHCR_IMAGE}",
            plan.tag
        ));
        return Ok(());
    }
    if plan.pull_ghcr {
        stage.note("GHCR sandbox image unavailable; building locally");
    }
    let context = super::repo_root().join(CONTEXT_REL);
    let mut build = Command::new("docker");
    build.args(build_args(&plan.tag, &context));
    stage.run(&format!("Building sandbox image {}", plan.tag), &mut build)
}

fn pull_and_retag() -> bool {
    docker_succeeds(&pull_args(GHCR_LATEST))
        && docker_succeeds(&tag_args(GHCR_LATEST, DEFAULT_LOCAL_TAG))
}

fn docker_succeeds(args: &[String]) -> bool {
    Command::new("docker")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}
