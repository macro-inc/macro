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

/// Reconcile the runtime image for the host arch through BuildKit.
///
/// BuildKit's content cache makes an unchanged build cheap while still
/// invalidating the image when the Dockerfile or build context changes.
/// Existence alone is not a valid cache key because the tag survives branch
/// checkouts. `force` disables BuildKit's layer cache.
pub fn ensure_runtime_image(stage: &Stage, target: Target, force: bool) -> Result<()> {
    let ws = workspace_root();
    let mut cmd = Command::new("docker");
    cmd.current_dir(&ws)
        .args(["buildx", "build", "--platform", target.docker_platform])
        .args(["-f", DOCKERFILE_REL])
        .args(["-t", RUNTIME_IMAGE_TAG])
        .arg("--load");
    if force {
        cmd.arg("--no-cache");
    }
    cmd.arg(".");
    stage.run(
        &format!("Building runtime image {RUNTIME_IMAGE_TAG}"),
        &mut cmd,
    )
}
