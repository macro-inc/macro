//! Machine-wide allocation of port windows and Docker subnets, so any number of
//! named instances can run at once without anyone picking a `--port-base`.
//!
//! Start flows call [`allocate`] in their first second, before any build. Under
//! one lock it reads what the machine actually holds (Docker's containers and
//! networks, listening ports, host routes) plus the registry of in-flight
//! allocations, and records a free window and subnet block. Docker stays the
//! source of truth for existing instances: one whose containers bind a window
//! keeps it, whichever tool or flag created it, and existing networks keep
//! their subnets. The registry only has to cover what Docker can't show yet: a
//! start that is still building.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::net::{Ipv4Addr, TcpListener};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

use super::Mode;
use super::docker;
use super::instance::{BUCKETS, DEFAULT_NAME, Instance, Port, STRIDE, WINDOW_START, fnv1a};
use super::stage::Stage;

#[cfg(test)]
mod test;

/// Instance subnets are `10.254.<block>.0/24`, split into one `/26` per network.
pub const SUBNET_PREFIX: &str = "10.254";
pub const NETWORK_BLOCK_SIZE: usize = 64;
const SUBNET_BLOCKS: u32 = 256;

/// The ports one window reserves. Wider than the allocated offsets to leave room
/// for what's conventionally added by hand, `tailscale serve` on proxy port + 40.
const WINDOW_WIDTH: u16 = 50;

const REGISTRY_FILE: &str = "instances.json";
const LOCK_FILE: &str = "instances.lock";

/// One instance's allocation, as recorded in the registry.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
struct Allocation {
    port_base: u16,
    subnet_block: u8,
    /// The process that allocated this. Keeps the allocation reserved during a
    /// build, before the instance has any Docker resources.
    owner_pid: u32,
}

type Registry = BTreeMap<String, Allocation>;

/// What stops a port window being used.
#[derive(Debug, PartialEq, Eq)]
enum WindowBlocker {
    /// Another instance's window overlaps it.
    Instance(String),
    /// Something other than this instance is on one of its ports.
    Port(u16),
}

impl std::fmt::Display for WindowBlocker {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WindowBlocker::Instance(name) => write!(f, "instance {name} holds it"),
            WindowBlocker::Port(port) => write!(f, "port {port} is in use"),
        }
    }
}

/// What a window has to avoid.
struct PortUse<'a> {
    /// Other instances' window bases.
    claimed: &'a BTreeMap<String, u16>,
    /// Host ports other containers publish. Docker can publish without a
    /// listening socket, so a bind probe alone wouldn't see them.
    published_by_others: &'a BTreeSet<u16>,
    /// Host ports this instance's own containers publish; these aren't conflicts.
    published_by_self: &'a BTreeSet<u16>,
    /// Whether a port can be bound right now.
    bindable: &'a dyn Fn(u16) -> bool,
}

impl PortUse<'_> {
    fn blocker(&self, base: u16) -> Option<WindowBlocker> {
        let overlapping = self
            .claimed
            .iter()
            .find(|(_, other)| windows_overlap(base, **other));
        if let Some((name, _)) = overlapping {
            return Some(WindowBlocker::Instance(name.clone()));
        }

        // After the overlap check on purpose: a probe's brief bind must never
        // touch a window another start has reserved.
        Port::all()
            .filter(|port| port.is_bound())
            .map(|port| base + port.offset())
            .filter(|port| !self.published_by_self.contains(port))
            .find(|port| self.published_by_others.contains(port) || !(self.bindable)(*port))
            .map(WindowBlocker::Port)
    }
}

fn windows_overlap(left: u16, right: u16) -> bool {
    u32::from(left) < u32::from(right) + u32::from(WINDOW_WIDTH)
        && u32::from(right) < u32::from(left) + u32::from(WINDOW_WIDTH)
}

/// The first usable window: `preferred` (what the instance already holds), then
/// the name's hashed bucket, then the following buckets. Probing from the hash
/// keeps the same name on the same ports unless something is really in the way.
fn choose_window(name: &str, preferred: Option<u16>, ports: &PortUse<'_>) -> Option<u16> {
    let start = fnv1a(name) % BUCKETS;
    let hashed =
        (0..BUCKETS).map(|step| (WINDOW_START + ((start + step) % BUCKETS) * STRIDE) as u16);
    preferred
        .into_iter()
        .chain(hashed)
        .find(|base| ports.blocker(*base).is_none())
}

/// An IPv4 range, for overlap checks.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Ipv4Range {
    first: u32,
    last: u32,
}

impl Ipv4Range {
    fn from_prefix(address: Ipv4Addr, prefix: u8) -> Option<Self> {
        if prefix > 32 {
            return None;
        }
        let mask = u32::MAX.checked_shl(u32::from(32 - prefix)).unwrap_or(0);
        let first = u32::from(address) & mask;
        Some(Ipv4Range {
            first,
            last: first | !mask,
        })
    }

    /// Parse `a.b.c.d/n`; IPv6 subnets aren't ranges we allocate from, so `None`.
    fn parse(cidr: &str) -> Option<Self> {
        let (address, prefix) = cidr.split_once('/')?;
        Self::from_prefix(address.parse().ok()?, prefix.parse().ok()?)
    }

    fn overlaps(self, other: Ipv4Range) -> bool {
        self.first <= other.last && other.first <= self.last
    }
}

fn block_range(block: u8) -> Ipv4Range {
    let address = Ipv4Addr::from(u32::from_be_bytes([10, 254, block, 0]));
    Ipv4Range::from_prefix(address, 24).expect("24 is a valid IPv4 prefix")
}

/// The first subnet block overlapping nothing in `used` and not in `claimed`:
/// `preferred`, then the name's hashed block, then the following blocks.
fn choose_block(
    name: &str,
    preferred: Option<u8>,
    used: &[Ipv4Range],
    claimed: &BTreeSet<u8>,
) -> Option<u8> {
    let start = fnv1a(name) % SUBNET_BLOCKS;
    let hashed = (0..SUBNET_BLOCKS).map(|step| ((start + step) % SUBNET_BLOCKS) as u8);
    preferred.into_iter().chain(hashed).find(|block| {
        let range = block_range(*block);
        !claimed.contains(block) && !used.iter().any(|other| other.overlaps(range))
    })
}

/// Host routes from `/proc/net/route`. Docker checks these when it picks a
/// subnet itself but not for one it's given, and a clash cuts this machine off
/// from whatever that route reaches (often a VPN). Default routes are skipped.
fn parse_routes(table: &str) -> Vec<Ipv4Range> {
    table
        .lines()
        .skip(1)
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            let destination = u32::from_str_radix(fields.get(1)?, 16).ok()?;
            let mask = u32::from_str_radix(fields.get(7)?, 16).ok()?;
            if mask == 0 {
                return None;
            }
            let address = Ipv4Addr::from(destination.swap_bytes());
            Ipv4Range::from_prefix(address, mask.count_ones() as u8)
        })
        .collect()
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

fn instance_of_project(project: &str) -> Option<&str> {
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
                .and_then(instance_of_project)
        })?;
    (!name.is_empty()).then_some(name)
}

/// What Docker holds right now.
struct Machine {
    networks: Vec<docker::NetworkSubnets>,
    containers: Vec<docker::MachineContainer>,
}

impl Machine {
    fn read() -> Result<Self> {
        Ok(Machine {
            networks: docker::list_networks()?,
            containers: docker::list_containers()?,
        })
    }

    /// Each compose project's containers, by instance name. The default instance
    /// holds fixed ports rather than a window, so it isn't listed.
    fn containers_by_instance(&self) -> BTreeMap<&str, Vec<&docker::MachineContainer>> {
        let mut by_instance: BTreeMap<&str, Vec<&docker::MachineContainer>> = BTreeMap::new();
        for container in &self.containers {
            let name = container.project.as_deref().and_then(instance_of_project);
            if let Some(name) = name {
                by_instance.entry(name).or_default().push(container);
            }
        }
        by_instance
    }

    /// Each instance's window, as its containers bind it (stopped ones too).
    fn windows(&self) -> BTreeMap<String, u16> {
        self.containers_by_instance()
            .into_iter()
            .filter_map(|(name, containers)| {
                containers_window(&containers).map(|base| (name.to_string(), base))
            })
            .collect()
    }

    /// One instance's window, as its containers bind it.
    fn window_of(&self, name: &str) -> Option<u16> {
        containers_window(self.containers_by_instance().get(name)?)
    }

    /// Whether Docker holds anything of this instance.
    fn has_instance(&self, name: &str) -> bool {
        let project = format!("macro-{name}");
        let has_container = self
            .containers
            .iter()
            .any(|container| container.project.as_deref() == Some(project.as_str()));
        has_container
            || self
                .networks
                .iter()
                .any(|network| instance_of_network(&network.name) == Some(name))
    }

    /// Host ports published by containers of `project`, or of every other
    /// project, into separate sets.
    fn published_split(&self, project: &str) -> (BTreeSet<u16>, BTreeSet<u16>) {
        let mut own = BTreeSet::new();
        let mut others = BTreeSet::new();
        for container in &self.containers {
            let set = if container.project.as_deref() == Some(project) {
                &mut own
            } else {
                &mut others
            };
            set.extend(container.published.iter().copied());
        }
        (own, others)
    }

    /// Every range `instance` can't use: other networks' subnets, and host
    /// routes. Each Docker bridge adds a host route for its own subnet, so
    /// routes matching a Docker network are left to the network check, or an
    /// instance's own networks would push it off its block.
    fn used_subnets(&self, instance: &Instance, routes: Vec<Ipv4Range>) -> Vec<Ipv4Range> {
        let own: BTreeSet<String> = instance
            .networks()
            .into_iter()
            .map(|(name, _)| name)
            .collect();
        let subnets = |network: &docker::NetworkSubnets| -> Vec<Ipv4Range> {
            network
                .subnets
                .iter()
                .filter_map(|cidr| Ipv4Range::parse(cidr))
                .collect()
        };
        let docker: Vec<Ipv4Range> = self.networks.iter().flat_map(subnets).collect();
        self.networks
            .iter()
            .filter(|network| !own.contains(&network.name))
            .flat_map(subnets)
            .chain(routes.into_iter().filter(|route| !docker.contains(route)))
            .collect()
    }
}

fn state_dir() -> Result<PathBuf> {
    let home = macro_env_var::maybe_read_env("HOME").context("HOME is not set")?;
    Ok(Path::new(&home).join(".local/state/macro-local"))
}

/// Hold the machine-wide allocation lock until the returned file drops.
fn lock(dir: &Path) -> Result<File> {
    std::fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
    let path = dir.join(LOCK_FILE);
    let file = File::create(&path).with_context(|| format!("creating {}", path.display()))?;
    file.lock()
        .with_context(|| format!("locking {}", path.display()))?;
    Ok(file)
}

/// A missing file is an empty registry. A file we can't parse is too: it only
/// holds in-flight reservations, so failing would block every start for good.
fn read_registry(dir: &Path) -> Registry {
    std::fs::read_to_string(dir.join(REGISTRY_FILE))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_registry(dir: &Path, registry: &Registry) -> Result<()> {
    let path = dir.join(REGISTRY_FILE);
    let staged = dir.join(format!("{REGISTRY_FILE}.{}", std::process::id()));
    std::fs::write(&staged, serde_json::to_string_pretty(registry)?)
        .with_context(|| format!("writing {}", staged.display()))?;
    std::fs::rename(&staged, &path).with_context(|| format!("replacing {}", path.display()))
}

fn process_alive(pid: u32) -> bool {
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return false;
    };
    // SAFETY: signal 0 only checks that the process exists; nothing is sent.
    let result = unsafe { libc::kill(pid, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
}

fn port_bindable(port: u16) -> bool {
    TcpListener::bind(("0.0.0.0", port)).is_ok()
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

    let dir = state_dir()?;
    let _lock = lock(&dir)?;
    let machine = Machine::read().context(
        "reading Docker's containers and networks; is the daemon running? `just doctor-local` checks",
    )?;
    let mut registry = read_registry(&dir);
    registry.retain(|other, allocation| {
        other == instance.name()
            || machine.has_instance(other)
            || process_alive(allocation.owner_pid)
    });

    let mut windows = machine.windows();
    let own_window = windows.remove(instance.name());
    let mut claimed: BTreeMap<String, u16> = registry
        .iter()
        .filter(|(other, _)| other.as_str() != instance.name() && other.as_str() != DEFAULT_NAME)
        .map(|(other, allocation)| (other.clone(), allocation.port_base))
        .collect();
    claimed.extend(windows);

    let (published_by_self, published_by_others) = machine.published_split(instance.project_name());
    let ports = PortUse {
        claimed: &claimed,
        published_by_others: &published_by_others,
        published_by_self: &published_by_self,
        bindable: &port_bindable,
    };
    let recorded = registry.get(instance.name()).copied();
    let port_base = if instance.is_default() {
        ensure_default_ports_free(mode, &ports)?;
        instance.port_base()
    } else if let Some(base) = explicit_base {
        if let Some(blocker) = ports.blocker(base) {
            bail!(
                "port window {base} isn't free: {blocker}. Drop --port-base and one is \
                 allocated for you"
            );
        }
        base
    } else {
        let preferred = own_window.or(recorded.map(|allocation| allocation.port_base));
        choose_window(instance.name(), preferred, &ports)
            .with_context(|| exhausted_message("port windows", &machine))?
    };

    let used_subnets = machine.used_subnets(
        &instance,
        parse_routes(&std::fs::read_to_string("/proc/net/route").unwrap_or_default()),
    );
    let claimed_blocks: BTreeSet<u8> = registry
        .iter()
        .filter(|(other, _)| other.as_str() != instance.name())
        .map(|(_, allocation)| allocation.subnet_block)
        .collect();
    let subnet_block = choose_block(
        instance.name(),
        recorded.map(|allocation| allocation.subnet_block),
        &used_subnets,
        &claimed_blocks,
    )
    .with_context(|| exhausted_message("Docker subnets", &machine))?;

    registry.insert(
        instance.name().to_string(),
        Allocation {
            port_base,
            subnet_block,
            owner_pid: std::process::id(),
        },
    );
    write_registry(&dir, &registry)?;

    if !instance.is_default() {
        stage.note(&format!(
            "ports {port_base}+, subnet {SUBNET_PREFIX}.{subnet_block}.0/24"
        ));
    }
    Ok(instance.with_allocation(port_base, Some(subnet_block)))
}

/// The default instance's ports are fixed, so there's no window to move to: say
/// so before the build rather than at `docker compose up` after it. Dev publishes
/// only a few of them, so it's left to Compose. Vite isn't checked because
/// headless stacks don't start it.
fn ensure_default_ports_free(mode: Mode, ports: &PortUse<'_>) -> Result<()> {
    if !mode.spec().runs_local_infra {
        return Ok(());
    }
    let busy: Vec<String> = Port::all()
        .filter(|port| port.is_bound() && *port != Port::Frontend)
        .map(Port::fixed)
        .filter(|port| !ports.published_by_self.contains(port) && !(ports.bindable)(*port))
        .map(|port| port.to_string())
        .collect();
    if !busy.is_empty() {
        bail!(
            "ports {} are in use, and the default instance's ports are fixed. Use a named \
             instance, which gets a free window: --instance <name>",
            busy.join(", ")
        );
    }
    Ok(())
}

/// Find where an existing instance is: a `--port-base` flag (`derive` applied
/// it), its containers' binding, its recorded allocation, then the hashed window.
/// Docker being unreachable isn't an error here: these commands report that
/// themselves, and some don't need Docker.
pub fn resolve(instance: Instance, flagged_base: bool) -> Instance {
    let recorded = state_dir()
        .ok()
        .and_then(|dir| read_registry(&dir).get(instance.name()).copied());
    let subnet_block = recorded.map(|allocation| allocation.subnet_block);
    if instance.is_default() || flagged_base {
        let port_base = instance.port_base();
        return instance.with_allocation(port_base, subnet_block);
    }

    let from_containers = Machine::read()
        .ok()
        .and_then(|machine| machine.window_of(instance.name()));
    let port_base = from_containers
        .or(recorded.map(|allocation| allocation.port_base))
        .unwrap_or(instance.port_base());
    instance.with_allocation(port_base, subnet_block)
}

/// Forget an instance's allocation once its resources are gone.
pub fn release(instance: &Instance) -> Result<()> {
    let dir = state_dir()?;
    let _lock = lock(&dir)?;
    let mut registry = read_registry(&dir);
    if registry.remove(instance.name()).is_some() {
        write_registry(&dir, &registry)?;
    }
    Ok(())
}

/// Named instances on this machine, by what they still hold.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Census {
    /// At least one container running.
    pub running: Vec<String>,
    /// Containers exist, none running: holds a port window and subnets.
    pub stopped: Vec<String>,
    /// Only networks left: holds subnets.
    pub networks_only: Vec<String>,
}

impl Census {
    fn from_machine(machine: &Machine) -> Self {
        let mut census = Census::default();
        let by_instance = machine.containers_by_instance();
        for (name, containers) in &by_instance {
            if containers.iter().any(|container| container.running) {
                census.running.push((*name).to_string());
            } else {
                census.stopped.push((*name).to_string());
            }
        }

        let network_owners: BTreeSet<&str> = machine
            .networks
            .iter()
            .filter_map(|network| instance_of_network(&network.name))
            .collect();
        census.networks_only = network_owners
            .into_iter()
            .filter(|name| !by_instance.contains_key(name))
            .map(str::to_string)
            .collect();
        census
    }

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

/// How the machine's named instances stand, for `doctor-local`.
pub fn census() -> Result<Census> {
    Ok(Census::from_machine(&Machine::read()?))
}

fn exhausted_message(what: &str, machine: &Machine) -> String {
    let census = Census::from_machine(machine);
    let leftovers = census
        .leftovers_message()
        .unwrap_or_else(|| "nothing is left over to free".to_string());
    format!(
        "no free {what} on this machine: {} instances running; {leftovers}",
        census.running.len()
    )
}

/// The ports in `instance`'s window something other than its own containers
/// holds, for `doctor-local`.
pub fn busy_ports(instance: &Instance) -> Result<Vec<u16>> {
    let machine = Machine::read()?;
    let (own, others) = machine.published_split(instance.project_name());
    Ok(Port::all()
        .filter(|port| port.is_bound())
        .map(|port| instance.port(port))
        .filter(|port| !own.contains(port) && (others.contains(port) || !port_bindable(*port)))
        .collect())
}
