//! What the machine holds, as the caller read it from Docker: the facts an
//! allocation has to avoid, and the census of instances.

use std::collections::{BTreeMap, BTreeSet};

use crate::layout::DEFAULT_INSTANCE;
use crate::net::Ipv4Range;

#[cfg(test)]
mod test;

/// A container, attributed to the instance whose Compose project created it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Container {
    /// The instance it belongs to (`macro` for the default instance's), or
    /// `None` for containers no instance created.
    pub owner: Option<String>,
    /// Whether it is running.
    pub running: bool,
    /// Host ports it publishes right now; empty when stopped.
    pub published: Vec<u16>,
}

/// A Docker network and its IPv4 subnets.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Network {
    /// The network's Docker name.
    pub name: String,
    /// The named instance it belongs to. `None` for the default instance's
    /// shared networks and for networks no instance created.
    pub owner: Option<String>,
    /// Its IPv4 subnets.
    pub subnets: Vec<Ipv4Range>,
}

/// What the machine holds right now. Docker is the source of truth for
/// existing instances: one whose containers bind a window keeps it, whichever
/// tool or flag created it, and existing networks keep their subnets.
#[derive(Clone, Debug, Default)]
pub struct Machine {
    /// Every container, running or not.
    pub containers: Vec<Container>,
    /// Every network.
    pub networks: Vec<Network>,
    /// Each named instance's window base, as its containers bind it (stopped
    /// ones too).
    pub windows: BTreeMap<String, u16>,
    /// The host's routes, from [`crate::host_routes`].
    pub routes: Vec<Ipv4Range>,
}

impl Machine {
    /// Each named instance's containers. The default instance holds fixed ports
    /// rather than a window, so it isn't listed.
    fn containers_by_instance(&self) -> BTreeMap<&str, Vec<&Container>> {
        let mut by_instance: BTreeMap<&str, Vec<&Container>> = BTreeMap::new();
        for container in &self.containers {
            let owner = container.owner.as_deref();
            if let Some(name) = owner.filter(|name| *name != DEFAULT_INSTANCE) {
                by_instance.entry(name).or_default().push(container);
            }
        }
        by_instance
    }

    /// Whether Docker holds anything of this named instance.
    pub(crate) fn has_instance(&self, name: &str) -> bool {
        self.containers_by_instance().contains_key(name)
            || self
                .networks
                .iter()
                .any(|network| network.owner.as_deref() == Some(name))
    }

    /// Host ports published by `owner`'s containers, and by every other
    /// container, as separate sets.
    pub(crate) fn published_split(&self, owner: &str) -> (BTreeSet<u16>, BTreeSet<u16>) {
        let mut own = BTreeSet::new();
        let mut others = BTreeSet::new();
        for container in &self.containers {
            let set = if container.owner.as_deref() == Some(owner) {
                &mut own
            } else {
                &mut others
            };
            set.extend(container.published.iter().copied());
        }
        (own, others)
    }

    /// Every range an instance whose networks are `own_networks` can't use:
    /// other networks' subnets, and host routes. Each Docker bridge adds a host
    /// route for its own subnet, so routes matching a Docker network are left
    /// to the network check, or an instance's own networks would push it off
    /// its block.
    pub(crate) fn used_subnets(&self, own_networks: &BTreeSet<String>) -> Vec<Ipv4Range> {
        let docker: Vec<Ipv4Range> = self
            .networks
            .iter()
            .flat_map(|network| network.subnets.iter().copied())
            .collect();
        self.networks
            .iter()
            .filter(|network| !own_networks.contains(&network.name))
            .flat_map(|network| network.subnets.iter().copied())
            .chain(
                self.routes
                    .iter()
                    .copied()
                    .filter(|route| !docker.contains(route)),
            )
            .collect()
    }

    /// The ports among `ports` something other than `owner`'s own containers
    /// holds: published by another container, or not bindable.
    pub fn busy_ports(
        &self,
        owner: &str,
        ports: impl IntoIterator<Item = u16>,
        bindable: impl Fn(u16) -> bool,
    ) -> Vec<u16> {
        let (own, others) = self.published_split(owner);
        ports
            .into_iter()
            .filter(|port| !own.contains(port) && (others.contains(port) || !bindable(*port)))
            .collect()
    }

    /// How the machine's named instances stand.
    pub fn census(&self) -> Census {
        let mut census = Census::default();
        let by_instance = self.containers_by_instance();
        for (name, containers) in &by_instance {
            if containers.iter().any(|container| container.running) {
                census.running.push((*name).to_string());
            } else {
                census.stopped.push((*name).to_string());
            }
        }

        let network_owners: BTreeSet<&str> = self
            .networks
            .iter()
            .filter_map(|network| network.owner.as_deref())
            .collect();
        census.networks_only = network_owners
            .into_iter()
            .filter(|name| !by_instance.contains_key(name))
            .map(str::to_string)
            .collect();
        census
    }
}

/// Named instances on this machine, by what they still hold.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Census {
    /// At least one container running.
    pub running: Vec<String>,
    /// Containers exist, none running: holds a port window and subnets.
    pub stopped: Vec<String>,
    /// Only networks left: holds subnets.
    pub networks_only: Vec<String>,
}

impl Census {
    /// Instances holding allocations with nothing running, named for a person to
    /// decide about. Never removed automatically: they may be someone's data.
    pub fn leftovers_message(&self) -> Option<String> {
        if self.stopped.is_empty() && self.networks_only.is_empty() {
            return None;
        }
        Some(format!(
            "stopped: {}; networks only: {}. Check one is unused, then `just destroy_local \
             --instance <name>` frees it",
            list_or_none(&self.stopped),
            list_or_none(&self.networks_only),
        ))
    }
}

fn list_or_none(names: &[String]) -> String {
    if names.is_empty() {
        "none".to_string()
    } else {
        names.join(", ")
    }
}
