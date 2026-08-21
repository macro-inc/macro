//! The minimal runtime image the service binaries run inside.
//!
//! On Linux the image is Nixpkgs `dockerTools.buildLayeredImage` (see
//! `nix/_containers/runtime.nix`). Binaries still arrive via the `/app/out`
//! bind mount, so the image does not rebuild when Rust code changes.
//!
//! macOS keeps the Dockerfile BuildKit path: a typical Mac flake eval cannot
//! build `aarch64-linux` dockerTools images without a Linux remote builder.

use std::process::Command;

use anyhow::{Context, Result};

use super::super::arch::Target;
use super::super::{stage::Stage, workspace_root};

/// The shared runtime image tag. Not per-instance: the image has no
/// instance-specific content.
pub const RUNTIME_IMAGE_TAG: &str = "macro-local-runtime:dev";

const DOCKERFILE_REL: &str = "docker/Dockerfile.runtime";
const NIX_STREAM_ATTR: &str = ".#stream-docker-image-local-runtime";

/// Reconcile the runtime image for the host arch.
///
/// Linux loads the flake's dockerTools stream. Darwin uses BuildKit. `force`
/// rebuilds from scratch (`nix build --rebuild` / `--no-cache`).
pub fn ensure_runtime_image(stage: &Stage, target: Target, force: bool) -> Result<()> {
    if cfg!(target_os = "linux") {
        nix_load_runtime_image(stage, force)
    } else {
        docker_build_runtime_image(stage, target, force)
    }
}

fn nix_load_runtime_image(stage: &Stage, force: bool) -> Result<()> {
    let ws = workspace_root();
    let out_link = ws.join("target/nix/stream-docker-image-local-runtime");
    if let Some(parent) = out_link.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }

    let mut build = Command::new("nix");
    build
        .current_dir(&ws)
        .args(["build", "--print-build-logs", NIX_STREAM_ATTR])
        .args(["--out-link"])
        .arg(&out_link);
    if force {
        build.arg("--rebuild");
    }
    stage.run("Building Nix runtime image", &mut build)?;

    // `Stage::run` captures stdout/stderr; piping the stream into `docker load`
    // has to happen inside one process so the capture doesn't steal the image
    // tarball. `$0` is the dummy argv0, `$1` is the stream script.
    let mut load = Command::new("sh");
    load.arg("-c")
        .arg("exec \"$1\" | docker load")
        .arg("nix-stream-runtime-image")
        .arg(&out_link);
    stage.run(
        &format!("Loading runtime image {RUNTIME_IMAGE_TAG}"),
        &mut load,
    )
}

fn docker_build_runtime_image(stage: &Stage, target: Target, force: bool) -> Result<()> {
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
