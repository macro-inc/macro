//! Thin bollard-backed helpers for the discrete Docker Engine operations the
//! orchestrator needs outside of `docker compose` — idempotently ensuring the
//! per-instance external networks/volumes. (Compose orchestration itself stays
//! on the CLI; bollard has no compose support.)

use anyhow::{Context, Result};
use bollard::Docker;
use bollard::models::{Ipam, IpamConfig, NetworkCreateRequest, VolumeCreateRequest};
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

/// Idempotently create a bridge network (no-op if it already exists, whatever
/// its subnet), on `subnet` when one is given.
pub fn ensure_network(name: &str, subnet: Option<&str>) -> Result<()> {
    block_on(async {
        let docker = connect()?;
        match docker
            .create_network(NetworkCreateRequest {
                name: name.to_string(),
                ipam: subnet.map(|subnet| Ipam {
                    config: Some(vec![IpamConfig {
                        subnet: Some(subnet.to_string()),
                        ..Default::default()
                    }]),
                    ..Default::default()
                }),
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

/// A Docker network's name and subnets, as an allocation must avoid them.
pub struct NetworkSubnets {
    pub name: String,
    pub subnets: Vec<String>,
}

/// Every network on the daemon.
pub fn list_networks() -> Result<Vec<NetworkSubnets>> {
    block_on(async {
        let docker = connect()?;
        let networks = docker
            .list_networks(None)
            .await
            .context("listing networks")?
            .into_iter()
            .map(|network| NetworkSubnets {
                name: network.name.unwrap_or_default(),
                subnets: network
                    .ipam
                    .and_then(|ipam| ipam.config)
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|config| config.subnet)
                    .collect(),
            })
            .collect();
        Ok(networks)
    })
}

/// A container on the daemon, with what port allocation needs to know about it.
pub struct MachineContainer {
    pub id: String,
    /// The Compose project, for containers Compose created.
    pub project: Option<String>,
    /// The Compose service, for containers Compose created.
    pub service: Option<String>,
    pub running: bool,
    /// Host ports published right now; empty when stopped.
    pub published: Vec<u16>,
}

/// Every container on the daemon, running or not.
pub fn list_containers() -> Result<Vec<MachineContainer>> {
    use bollard::models::ContainerSummaryStateEnum;
    use bollard::query_parameters::ListContainersOptionsBuilder;

    block_on(async {
        let docker = connect()?;
        let options = ListContainersOptionsBuilder::new().all(true).build();
        let containers = docker
            .list_containers(Some(options))
            .await
            .context("listing containers")?
            .into_iter()
            .map(|container| {
                let mut labels = container.labels.unwrap_or_default();
                MachineContainer {
                    id: container.id.unwrap_or_default(),
                    project: labels.remove("com.docker.compose.project"),
                    service: labels.remove("com.docker.compose.service"),
                    running: container.state == Some(ContainerSummaryStateEnum::RUNNING),
                    published: container
                        .ports
                        .unwrap_or_default()
                        .iter()
                        .filter_map(|port| port.public_port)
                        .collect(),
                }
            })
            .collect();
        Ok(containers)
    })
}

/// The host port a container is configured to bind for `container_port` (such
/// as `5432/tcp`). Reads the configuration, so it answers for stopped containers.
pub fn configured_host_port(container_id: &str, container_port: &str) -> Result<Option<u16>> {
    block_on(async {
        let docker = connect()?;
        let inspected = docker
            .inspect_container(container_id, None)
            .await
            .with_context(|| format!("inspecting container {container_id}"))?;
        let host_port = inspected
            .host_config
            .and_then(|config| config.port_bindings)
            .and_then(|mut bindings| bindings.remove(container_port))
            .flatten()
            .and_then(|bindings| bindings.into_iter().find_map(|binding| binding.host_port))
            .and_then(|port| port.parse().ok());
        Ok(host_port)
    })
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
