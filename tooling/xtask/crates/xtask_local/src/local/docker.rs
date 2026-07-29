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

/// A container belonging to a compose project, as `status-local` reports it.
pub struct ProjectContainer {
    /// Container name (without the leading slash).
    pub name: String,
    /// Whether the container is currently running.
    pub running: bool,
    /// Human-readable status, e.g. `Up 3 hours (healthy)`.
    pub status: String,
    /// Published host ports, sorted and deduplicated.
    pub host_ports: Vec<u16>,
}

/// List every container (running or not) labeled with the compose `project`.
pub fn project_containers(project: &str) -> Result<Vec<ProjectContainer>> {
    use bollard::models::ContainerSummaryStateEnum;
    use bollard::query_parameters::ListContainersOptionsBuilder;

    block_on(async {
        let docker = connect()?;
        let filters = std::collections::HashMap::from([(
            "label",
            vec![format!("com.docker.compose.project={project}")],
        )]);
        let options = ListContainersOptionsBuilder::new()
            .all(true)
            .filters(&filters)
            .build();
        let mut containers: Vec<ProjectContainer> = docker
            .list_containers(Some(options))
            .await
            .context("listing containers")?
            .into_iter()
            .map(|c| {
                let name = c
                    .names
                    .unwrap_or_default()
                    .first()
                    .map(|n| n.trim_start_matches('/').to_string())
                    .or(c.id)
                    .unwrap_or_default();
                let mut host_ports: Vec<u16> = c
                    .ports
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|p| p.public_port)
                    .collect();
                host_ports.sort_unstable();
                host_ports.dedup();
                ProjectContainer {
                    name,
                    running: c.state == Some(ContainerSummaryStateEnum::RUNNING),
                    status: c.status.unwrap_or_default(),
                    host_ports,
                }
            })
            .collect();
        containers.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(containers)
    })
}
