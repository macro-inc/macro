//! The minimal runtime image the service binaries run inside.
//!
//! The image contains only runtime dependencies (ca-certificates, curl,
//! dumb-init) and *no* source or binaries — binaries arrive via the `/app/out`
//! bind mount. It therefore never needs rebuilding when Rust code changes.

use std::process::Command;

use anyhow::{Context, Result};
use sha2::{Digest, Sha256};

use super::super::arch::Target;
use super::super::{stage::Stage, workspace_root};

#[cfg(test)]
mod test;

/// The shared runtime image tag. Not per-instance: the image has no
/// instance-specific content.
pub const RUNTIME_IMAGE_TAG: &str = "macro-local-runtime:dev";

const DOCKERFILE_REL: &str = "docker/Dockerfile.runtime";

/// Image label carrying the content key of the inputs the image was built
/// from. A matching label is what lets a run skip the build entirely.
const KEY_LABEL: &str = "com.macro.local-runtime-key";

/// Reconcile the runtime image for the host arch through BuildKit.
///
/// BuildKit's content cache makes an *unchanged* rebuild cheap in the sense
/// that no layer re-executes — but `--load` still re-exports and unpacks the
/// image every time, which measured 32s warm and 2m29s cold on a 12-core
/// Linux host. So the fast path here is not building at all: key the image on
/// its inputs, stamp that key on as a label, and skip when the loaded image
/// already carries it. Existence alone was never a valid key (the tag survives
/// branch checkouts); a content key is, and it invalidates exactly when the
/// Dockerfile or the platform changes. `force` skips the check and disables
/// BuildKit's layer cache.
pub fn ensure_runtime_image(stage: &Stage, target: Target, force: bool) -> Result<()> {
    let ws = workspace_root();
    let key = content_key(target)?;
    if !force && current_key() == Some(key.clone()) {
        stage.note(&format!(
            "runtime image {RUNTIME_IMAGE_TAG} is up to date ({})",
            &key[..12]
        ));
        return Ok(());
    }
    let mut cmd = Command::new("docker");
    cmd.current_dir(&ws)
        .args(["buildx", "build", "--platform", target.docker_platform])
        .args(["-f", DOCKERFILE_REL])
        .args(["-t", RUNTIME_IMAGE_TAG])
        .args(["--label", &format!("{KEY_LABEL}={key}")])
        // Nothing consumes an attestation for a local dev image, and both
        // turn the `--load` into a manifest-list export.
        .args(["--provenance=false", "--sbom=false"])
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

/// Hash everything that decides the image's content: the Dockerfile and the
/// platform it is built for. The build context is the repository root, but the
/// Dockerfile copies nothing from it, so the context is not an input.
fn content_key(target: Target) -> Result<String> {
    let dockerfile = workspace_root().join(DOCKERFILE_REL);
    let mut hasher = Sha256::new();
    hasher.update(target.docker_platform.as_bytes());
    hasher.update(
        std::fs::read(&dockerfile).with_context(|| format!("reading {}", dockerfile.display()))?,
    );
    Ok(hex(&hasher.finalize()))
}

/// The key stamped on the currently loaded image, if any. Any failure (no
/// image, no daemon, no label) reads as "not current" and falls through to a
/// build, which then reports the real error.
fn current_key() -> Option<String> {
    let out = Command::new("docker")
        .args([
            "image",
            "inspect",
            RUNTIME_IMAGE_TAG,
            "--format",
            &format!("{{{{index .Config.Labels \"{KEY_LABEL}\"}}}}"),
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let key = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!key.is_empty() && key != "<no value>").then_some(key)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::new(), |mut s, b| {
        use std::fmt::Write;
        let _ = write!(s, "{b:02x}");
        s
    })
}
