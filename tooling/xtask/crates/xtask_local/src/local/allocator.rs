//! Machine-wide allocation of port windows and Docker subnets, so any number of
//! named instances can run at once without anyone picking a `--port-base`.
//!
//! The decisions live in `xtask_ports`; this module reads Docker into its
//! [`Machine`] and applies the result to an [`Instance`]. Start flows call
//! [`allocate`] in their first second, before any build.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{Context, Result};
use xtask_ports::{
    Census, Container, Ipv4Range, Machine, Network, Port, Registry, Request, SUBNET_PREFIX, Window,
    probe,
};

use super::Mode;
use super::docker;
use super::instance::{DEFAULT_NAME, Instance};
use super::stage::Stage;

#[cfg(test)]
mod test;

/// The instance a Compose project belongs to: `macro` is the default instance's.
fn instance_of_project(project: &str) -> Option<&str> {
    if project == DEFAULT_NAME {
        return Some(DEFAULT_NAME);
    }
    project
        .strip_prefix("macro-")
        .filter(|name| !name.is_empty())
}

/// The named instance a network belongs to, by the names [`Instance`] gives them.
fn instance_of_network(network: &str) -> Option<&str> {
    let name = network
        .strip_prefix("databases-")
        .or_else(|| network.strip_prefix("auth-"))
        .or_else(|| {
            network
                .strip_suffix("_services")
                .or_else(|| network.strip_suffix("_auth-internal"))
                .and_then(|project| project.strip_prefix("macro-"))
        })?;
    (!name.is_empty()).then_some(name)
}

/// The instance's window base, from the configured binding of a container every
/// local and dev stack has.
fn containers_window(containers: &[&docker::MachineContainer]) -> Option<u16> {
    for (service, container_port, port) in [
        ("postgres", "5432/tcp", Port::Postgres),
        ("localstack", "4566/tcp", Port::LocalStack),
    ] {
        let container = containers
            .iter()
            .find(|container| container.service.as_deref() == Some(service));
        let Some(container) = container else {
            continue;
        };
        // Another session can remove the container after it was listed.
        let host_port = docker::configured_host_port(&container.id, container_port)
            .ok()
            .flatten();
        if let Some(base) = host_port.and_then(|host| host.checked_sub(port.offset())) {
            return Some(base);
        }
    }
    None
}

/// Each named instance's containers. The default instance holds fixed ports
/// rather than a window, so it isn't listed.
fn named_containers(
    containers: &[docker::MachineContainer],
) -> BTreeMap<&str, Vec<&docker::MachineContainer>> {
    let mut by_instance: BTreeMap<&str, Vec<&docker::MachineContainer>> = BTreeMap::new();
    for container in containers {
        let name = container.project.as_deref().and_then(instance_of_project);
        if let Some(name) = name.filter(|name| *name != DEFAULT_NAME) {
            by_instance.entry(name).or_default().push(container);
        }
    }
    by_instance
}

/// What Docker holds right now, and the host's routes.
fn read_machine() -> Result<Machine> {
    let networks = docker::list_networks()?;
    let containers = docker::list_containers()?;
    let windows = named_containers(&containers)
        .into_iter()
        .filter_map(|(name, containers)| {
            containers_window(&containers).map(|base| (name.to_string(), base))
        })
        .collect();
    Ok(Machine {
        containers: containers
            .iter()
            .map(|container| Container {
                owner: container
                    .project
                    .as_deref()
                    .and_then(instance_of_project)
                    .map(str::to_string),
                running: container.running,
                published: container.published.clone(),
            })
            .collect(),
        networks: networks
            .into_iter()
            .map(|network| Network {
                owner: instance_of_network(&network.name).map(str::to_string),
                subnets: network
                    .subnets
                    .iter()
                    .filter_map(|cidr| Ipv4Range::parse(cidr))
                    .collect(),
                name: network.name,
            })
            .collect(),
        windows,
        routes: xtask_ports::host_routes(),
    })
}

/// Reserve a port window and subnet block for a stack about to start, in the
/// first second, before any build. Calling it again is safe and is how a start
/// re-checks after its build: it returns the same allocation unless something
/// has taken it since.
pub fn allocate(
    stage: &Stage,
    mode: Mode,
    name: Option<&str>,
    explicit_base: Option<u16>,
) -> Result<Instance> {
    let instance = Instance::derive(name, explicit_base)?;
    if stage.is_dry_run() {
        return Ok(instance);
    }

    let mut locked = Registry::machine()?.lock()?;
    let machine = read_machine().context(
        "reading Docker's containers and networks; is the daemon running? `just doctor-local` checks",
    )?;
    let window = if instance.is_default() {
        // Dev publishes only a few of the fixed ports, so it's left to Compose.
        Window::Fixed {
            base: instance.port_base(),
            check_free: mode.spec().runs_local_infra,
        }
    } else if let Some(base) = explicit_base {
        Window::Pinned(base)
    } else {
        Window::Any
    };
    let request = Request {
        name: instance.name(),
        own_networks: own_networks(&instance),
        window,
    };
    let allocation = locked.allocate(&request, &machine, &probe::bindable)?;

    if !instance.is_default() {
        stage.note(&format!(
            "ports {}+, subnet {SUBNET_PREFIX}.{}.0/24",
            allocation.port_base, allocation.subnet_block
        ));
    }
    Ok(instance.with_allocation(allocation.port_base, Some(allocation.subnet_block)))
}

fn own_networks(instance: &Instance) -> BTreeSet<String> {
    instance
        .networks()
        .into_iter()
        .map(|(name, _)| name)
        .collect()
}

/// Find where an existing instance is: a `--port-base` flag (`derive` applied
/// it), its containers' binding, its recorded allocation, then the hashed window.
/// Docker being unreachable isn't an error here: these commands report that
/// themselves, and some don't need Docker.
pub fn resolve(instance: Instance, flagged_base: bool) -> Instance {
    let recorded = Registry::machine()
        .ok()
        .and_then(|registry| registry.recorded(instance.name()));
    let subnet_block = recorded.map(|allocation| allocation.subnet_block);
    if instance.is_default() || flagged_base {
        let port_base = instance.port_base();
        return instance.with_allocation(port_base, subnet_block);
    }

    let from_containers = docker::list_containers().ok().and_then(|containers| {
        containers_window(named_containers(&containers).get(instance.name())?)
    });
    let port_base = from_containers
        .or(recorded.map(|allocation| allocation.port_base))
        .unwrap_or(instance.port_base());
    instance.with_allocation(port_base, subnet_block)
}

/// Forget an instance's allocation once its resources are gone.
pub fn release(instance: &Instance) -> Result<()> {
    Registry::machine()?.lock()?.release(instance.name())?;
    Ok(())
}

/// How the machine's named instances stand, for `doctor-local`.
pub fn census() -> Result<Census> {
    Ok(read_machine()?.census())
}

/// The ports in `instance`'s window something other than its own containers
/// holds, for `doctor-local`.
pub fn busy_ports(instance: &Instance) -> Result<Vec<u16>> {
    let ports = Port::all()
        .filter(|port| port.is_bound())
        .map(|port| instance.port(port));
    Ok(read_machine()?.busy_ports(instance.name(), ports, probe::bindable))
}
