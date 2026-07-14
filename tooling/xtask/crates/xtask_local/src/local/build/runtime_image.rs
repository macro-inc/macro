//! The minimal runtime image the service binaries run inside.
//!
//! The image contains only runtime dependencies (ca-certificates, curl,
//! dumb-init) and *no* source or binaries — binaries arrive via the `/app/out`
//! bind mount. It therefore never needs rebuilding when Rust code changes.

use std::process::Command;

use anyhow::Result;

use super::super::arch::Target;
use super::super::{stage::Stage, workspace_root};

/// The shared runtime image tag. Not per-instance: the image has no
/// instance-specific content.
pub const RUNTIME_IMAGE_TAG: &str = "macro-local-runtime:dev";

const DOCKERFILE_REL: &str = "docker/Dockerfile.runtime";

/// Build the runtime image for the host arch if it is missing (or `force`).
pub fn ensure_runtime_image(stage: &Stage, target: Target, force: bool) -> Result<()> {
    if !force && image_exists() {
        return Ok(());
    }
    let ws = workspace_root();
    let mut cmd = Command::new("docker");
    cmd.current_dir(&ws)
        .args(["buildx", "build", "--platform", target.docker_platform])
        .args(["-f", DOCKERFILE_REL])
        .args(["-t", RUNTIME_IMAGE_TAG])
        .arg("--load")
        .arg(".");
    stage.run(
        &format!("Building runtime image {RUNTIME_IMAGE_TAG}"),
        &mut cmd,
    )
}

fn image_exists() -> bool {
    super::super::docker::image_exists(RUNTIME_IMAGE_TAG)
}
