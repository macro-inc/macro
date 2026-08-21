//! Ensure the local agent-harness sandbox image exists before compose starts
//! the harness.
//!
//! When local sandboxes are on, `run_local` / `stack up` always `docker build`
//! the tag with no `--platform`, so the daemon's native arch wins. The sandbox
//! flake exposes `x86_64-linux` and `aarch64-linux`; Apple Silicon and ARM
//! Linux therefore bake natively instead of qemu. BuildKit cache is the
//! freshness check: unchanged `container/` is a no-op rebuild, a Dockerfile or
//! flake change pays the two nix shells. `--no-build` (Fly preview VM boot, CI
//! snapshot bake) skips that: the image is already on the daemon from preload /
//! the images lane, and the Fly VM's staged repo does not even include
//! `crates/agent_harness/container`.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use anyhow::Result;

use super::stage::Stage;

#[cfg(test)]
mod test;

/// Local Docker tag `just run_local` / Fly previews load. Keep in sync with
/// `xtask_workflows::workflows::vars::AGENT_HARNESS_LOCAL_IMAGE`.
pub const DEFAULT_LOCAL_TAG: &str = "macro-agent-harness:latest";

/// Build context matching `just -f crates/agent_harness/justfile build-local`.
pub const CONTEXT_REL: &str = "crates/agent_harness/container";

/// What [`ensure`] will do for a resolved env, before talking to Docker.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct EnsurePlan {
    /// Tag the harness is configured to run.
    pub tag: String,
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
        Some(Self { tag })
    }
}

/// Unpinned on purpose: `--platform` would force qemu on Apple Silicon.
pub(crate) fn build_args(tag: &str, context: &Path) -> Vec<String> {
    vec![
        "build".to_owned(),
        "--tag".to_owned(),
        tag.to_owned(),
        context.display().to_string(),
    ]
}

/// `docker build` the sandbox image when local sandboxes are on.
///
/// `no_build` skips the invocation so Fly / `--no-build` stack-up can use a
/// preloaded tag. Dry-run notes the plan and does not invoke Docker.
pub fn ensure(stage: &Stage, env: &BTreeMap<String, String>, no_build: bool) -> Result<()> {
    let Some(plan) = EnsurePlan::from_env(env) else {
        return Ok(());
    };
    if no_build {
        stage.note(&format!(
            "sandbox image: skipping build (--no-build); using {}",
            plan.tag
        ));
        return Ok(());
    }
    if stage.is_dry_run() {
        stage.note(&format!("sandbox image: would build {}", plan.tag));
        return Ok(());
    }
    let context = super::repo_root().join(CONTEXT_REL);
    let mut build = Command::new("docker");
    build.args(build_args(&plan.tag, &context));
    stage.run(&format!("Building sandbox image {}", plan.tag), &mut build)
}
