//! Thin bollard-backed helpers for the discrete Docker Engine operations the
//! orchestrator needs outside of `docker compose` — checking whether the
//! runtime image exists and idempotently ensuring the per-instance external
//! networks/volumes. (Compose orchestration itself stays on the CLI; bollard
//! has no compose support.)

use anyhow::{Context, Result};
use bollard::Docker;
use bollard::models::{NetworkCreateRequest, VolumeCreateRequest};
use macro_env_var::maybe_env_var;

/// Run a future to completion on a throwaway current-thread runtime (xtask's
/// flow is synchronous).
fn block_on<T>(fut: impl std::future::Future<Output = Result<T>>) -> Result<T> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .context("building tokio runtime")?
        .block_on(fut)
}

maybe_env_var! {
    struct UsePodman;
}
fn connect() -> Result<Docker> {
    match UsePodman::new()
        .map(|p| p.parse::<bool>().unwrap())
        .unwrap_or(false)
    {
        true => Docker::connect_with_podman_defaults().context("connecting to the Docker daemon"),
        false => Docker::connect_with_local_defaults().context("connecting to the Docker daemon"),
    }
}

/// Whether an image with `tag` exists locally.
pub fn image_exists(tag: &str) -> bool {
    block_on(async {
        let docker = connect()?;
        Ok::<_, anyhow::Error>(docker.inspect_image(tag).await.is_ok())
    })
    .unwrap_or(false)
}

/// Idempotently create a bridge network (no-op if it already exists).
pub fn ensure_network(name: &str) -> Result<()> {
    block_on(async {
        let docker = connect()?;
        match docker
            .create_network(NetworkCreateRequest {
                name: name.to_string(),
                ..Default::default()
            })
            .await
        {
            Ok(_) => Ok(()),
            Err(e) if already_exists(&e) => Ok(()),
            Err(e) => Err(e).with_context(|| format!("creating network {name}")),
        }
    })
}

/// Idempotently create a named volume (no-op if it already exists).
pub fn ensure_volume(name: &str) -> Result<()> {
    block_on(async {
        let docker = connect()?;
        match docker
            .create_volume(VolumeCreateRequest {
                name: Some(name.to_string()),
                ..Default::default()
            })
            .await
        {
            Ok(_) => Ok(()),
            Err(e) if already_exists(&e) => Ok(()),
            Err(e) => Err(e).with_context(|| format!("creating volume {name}")),
        }
    })
}

fn already_exists(e: &bollard::errors::Error) -> bool {
    let s = e.to_string();
    s.contains("already exists") || s.contains("409")
}
