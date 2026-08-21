//! The minimal runtime image the service binaries run inside.
//!
//! The image is Nixpkgs `dockerTools.buildLayeredImage` (see
//! `nix/_containers/runtime.nix`). Binaries still arrive via the `/app/out`
//! bind mount, so the image does not rebuild when Rust code changes.
//!
//! On macOS this realizes the GNU/Linux dockerTools derivation (see
//! `nix/docker-images.nix`) and needs a Linux remote builder.

use std::path::Path;
use std::process::Command;

use anyhow::{Context, Result};

use super::super::arch::Target;
use super::super::{stage::Stage, workspace_root};

/// The shared runtime image tag. Not per-instance: the image has no
/// instance-specific content.
pub const RUNTIME_IMAGE_TAG: &str = "macro-local-runtime:dev";

pub const NODE_BUN_IMAGE_TAG: &str = "macro-local-node-bun:dev";
pub const SDK_WEBHOOK_IMAGE_TAG: &str = "macro-sdk-webhook-relay:dev";

const NIX_STREAM_RUNTIME: &str = ".#stream-docker-image-local-runtime";
const NIX_STREAM_NODE_BUN: &str = ".#stream-docker-image-local-node-bun";
const NIX_STREAM_SDK_WEBHOOK: &str = ".#stream-docker-image-sdk-webhook-relay";

/// Reconcile the runtime image for the host arch.
pub fn ensure_runtime_image(stage: &Stage, _target: Target, force: bool) -> Result<()> {
    nix_load_stream(
        stage,
        NIX_STREAM_RUNTIME,
        "stream-docker-image-local-runtime",
        RUNTIME_IMAGE_TAG,
        force,
    )
}

/// Load the Node/Bun runtime and the SDK webhook relay used by aux services.
pub fn ensure_aux_images(stage: &Stage, force: bool) -> Result<()> {
    nix_load_stream(
        stage,
        NIX_STREAM_NODE_BUN,
        "stream-docker-image-local-node-bun",
        NODE_BUN_IMAGE_TAG,
        force,
    )?;
    nix_load_stream(
        stage,
        NIX_STREAM_SDK_WEBHOOK,
        "stream-docker-image-sdk-webhook-relay",
        SDK_WEBHOOK_IMAGE_TAG,
        force,
    )
}

fn nix_load_stream(
    stage: &Stage,
    attr: &str,
    out_name: &str,
    tag: &str,
    force: bool,
) -> Result<()> {
    let ws = workspace_root();
    let out_link = ws.join("target/nix").join(out_name);
    if let Some(parent) = out_link.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }

    let mut build = Command::new("nix");
    build
        .current_dir(&ws)
        .args(["build", "--print-build-logs", attr])
        .args(["--out-link"])
        .arg(&out_link);
    if force {
        build.arg("--rebuild");
    }
    stage.run(&format!("Building Nix image {tag}"), &mut build)?;

    load_stream(stage, &out_link, tag)
}

fn load_stream(stage: &Stage, stream: &Path, tag: &str) -> Result<()> {
    let mut load = Command::new("sh");
    load.arg("-c")
        .arg("exec \"$1\" | docker load")
        .arg("nix-stream-image")
        .arg(stream);
    stage.run(&format!("Loading image {tag}"), &mut load)
}
