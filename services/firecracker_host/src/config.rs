//! The agent's configuration: one TOML file written by the host's NixOS
//! module (`nix/hosts/_nixos/firecracker-host.nix`), its only source. A
//! missing or unknown key fails startup.

use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::time::Duration;

use serde::Deserialize;

#[cfg(test)]
mod test;

/// The whole file.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    /// Host name, for registration.
    pub host_name: String,
    /// Where the API listens: the tunnel or NIC address, never a wildcard.
    pub listen: SocketAddr,
    /// mTLS material.
    pub tls: TlsConfig,
    /// Firecracker release binaries.
    pub binaries: Binaries,
    /// Disks.
    pub storage: StorageConfig,
    /// Netns slots and guest egress.
    pub network: NetworkConfig,
    /// Per-VM users and cgroups.
    pub jail: JailConfig,
    /// Guest timings.
    pub guest: GuestConfig,
    /// Moving computers to and from other hosts (ZFS storage only); absent
    /// means this host neither sends nor receives computers.
    #[serde(default)]
    pub moves: Option<MovesConfig>,
}

/// The move listener other hosts push computers to.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MovesConfig {
    /// This host's address on the private mesh between hosts and a port,
    /// e.g. `10.88.0.2:8446`. The mesh (WireGuard) authenticates and
    /// encrypts the link; a per-computer ticket authorizes each push.
    pub listen: SocketAddr,
    /// How long connecting to another host's listener may take.
    #[serde(with = "seconds")]
    pub connect_timeout: Duration,
}

/// mTLS: our certificate, and the only client certificates accepted.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TlsConfig {
    /// PEM certificate the control plane pins.
    pub certificate: PathBuf,
    /// Its private key.
    pub key: PathBuf,
    /// PEM certificates of control planes; a client must present one of
    /// them byte for byte.
    pub client_certificates: Vec<PathBuf>,
}

/// Firecracker release binaries (`v1.18.0`).
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Binaries {
    /// `firecracker`.
    pub firecracker: PathBuf,
    /// `jailer`.
    pub jailer: PathBuf,
    /// Reported in host info.
    pub firecracker_version: String,
}

/// Storage.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StorageConfig {
    /// Installed images: `<images_dir>/<image>/{vmlinux,rootfs.ext4,boot_args}`.
    pub images_dir: PathBuf,
    /// Where records, disks, goldens, hibernation snapshots and jails live.
    pub disks: DiskStorage,
    /// Size the golden's rootfs is grown to before its boot (the guest grows
    /// its root filesystem at boot, not at restore): the root disk computers
    /// are sold with.
    pub golden_root_disk_gib: u32,
}

/// The durable storage everything lives on: one ZFS pool (the default) or
/// one XFS filesystem, either way able to clone files copy-on-write.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DiskStorage {
    /// Files on datasets of a pool with block cloning: one dataset per
    /// computer and per golden under `dataset` (which must exist, mounted).
    Zfs {
        /// The parent dataset, e.g. `tank/firecracker`.
        dataset: String,
    },
    /// Files on one XFS filesystem with reflink.
    Xfs {
        /// Its directory.
        directory: PathBuf,
    },
}

/// Netns slots and what guests may reach.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NetworkConfig {
    /// Slots created at startup: the most VMs with a process at once.
    pub slots: u16,
    /// Prefix of every name the agent creates (netns `<prefix>-<slot>`, host
    /// veth `<prefix>v<slot>`, nft tables `<prefix>`), so several agents or
    /// the spike can share a host.
    pub prefix: String,
    /// First address of the /16 the slots' veth /30s come from.
    pub veth_base: Ipv4Addr,
    /// Resolvers handed to guests.
    pub dns: Vec<String>,
    /// Host interface guests' traffic leaves by (masqueraded).
    pub uplink: String,
    /// Sources admitted to the API port.
    pub api_sources: Vec<Ipv4Addr>,
    /// A control plane on the tailnet that guests may reach.
    pub control_plane: Option<ControlPlaneAccess>,
    /// Private destinations guests may reach despite the private-range
    /// drop, each an exact address and TCP port (e.g. a stack's proxy in
    /// the same VPC).
    #[serde(default)]
    pub guest_destinations: Vec<GuestDestination>,
}

/// One exception to the private-range drop.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GuestDestination {
    /// IPv4 address.
    pub address: Ipv4Addr,
    /// TCP port.
    pub port: u16,
}

/// The tailnet exception of `incus-host.nix`.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControlPlaneAccess {
    /// Its Tailscale IPv4 address.
    pub address: Ipv4Addr,
    /// TCP ports guests may reach on it.
    pub ports: Vec<u16>,
}

/// Per-VM users and cgroups.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JailConfig {
    /// Slot `n` runs as uid and gid `uid_base + n`. No user or group may
    /// exist in the range: the agent refuses to start otherwise.
    pub uid_base: u32,
    /// Memory a VM's cgroup gets beyond its guest memory (Firecracker
    /// itself, page tables, the golden's shared page cache charged to it).
    pub memory_overhead_mib: u32,
}

/// Guest timings.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GuestConfig {
    /// Clean shutdown deadline before the process is killed.
    #[serde(with = "seconds")]
    pub shutdown_grace: Duration,
    /// How long a golden boot may take to settle.
    #[serde(with = "seconds")]
    pub golden_boot_timeout: Duration,
    /// How long a restored guest's agent may take to answer.
    #[serde(with = "seconds")]
    pub guest_agent_timeout: Duration,
    /// Boots, restores and wakes running at once; more wait their turn.
    /// The host saturates past ~10 restores a second on nested hosts; 8
    /// measured best for density.
    #[serde(default = "default_concurrent_launches")]
    pub concurrent_launches: u16,
}

fn default_concurrent_launches() -> u16 {
    8
}

mod seconds {
    use std::time::Duration;

    use serde::{Deserialize, Deserializer};

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Duration, D::Error> {
        u64::deserialize(deserializer).map(Duration::from_secs)
    }
}

/// The lowest `jail.uid_base`.
pub const MINIMUM_UID_BASE: u32 = 100_000_000;

/// The file could not be used.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    /// Not readable.
    #[error("could not read {path}: {source}")]
    Read {
        /// The file.
        path: PathBuf,
        /// Why.
        source: std::io::Error,
    },
    /// Not valid.
    #[error("invalid configuration {path}: {source}")]
    Parse {
        /// The file.
        path: PathBuf,
        /// Why.
        source: toml::de::Error,
    },
    /// Valid TOML, but unusable.
    #[error("invalid configuration: {0}")]
    Invalid(#[from] Invalid),
}

/// Why a parsed configuration is unusable.
#[derive(Debug, thiserror::Error)]
pub enum Invalid {
    /// `listen` is a wildcard.
    #[error("listen must be a specific address, never a wildcard")]
    WildcardListen,
    /// `moves.listen` is a wildcard.
    #[error("moves.listen must be the host's mesh address, never a wildcard")]
    WildcardMovesListen,
    /// `moves` without ZFS storage.
    #[error("moves need ZFS storage (storage.disks.kind = \"zfs\")")]
    MovesNeedZfs,
    /// `network.dns` is empty.
    #[error("network.dns needs a resolver: guests have none on their link")]
    NoDns,
    /// `network.slots` is out of range.
    #[error("network.slots must be 1..=16384")]
    SlotCount,
    /// `network.prefix` cannot name interfaces.
    #[error("network.prefix must be 1..=6 lowercase letters or digits")]
    NetworkPrefix,
    /// `jail.uid_base` overlaps system and build users.
    #[error("jail.uid_base must be at least {MINIMUM_UID_BASE}")]
    UidBase,
    /// `guest.concurrent_launches` is zero.
    #[error("guest.concurrent_launches must be at least 1")]
    NoLaunches,
    /// `tls.client_certificates` is empty.
    #[error("tls.client_certificates must name at least one control plane")]
    NoClientCertificates,
}

impl Config {
    /// Read and check the file.
    pub fn load(path: &std::path::Path) -> Result<Self, ConfigError> {
        let text = std::fs::read_to_string(path).map_err(|source| ConfigError::Read {
            path: path.to_owned(),
            source,
        })?;
        let config: Self = toml::from_str(&text).map_err(|source| ConfigError::Parse {
            path: path.to_owned(),
            source,
        })?;
        config.check()?;
        Ok(config)
    }

    fn check(&self) -> Result<(), ConfigError> {
        if self.listen.ip().is_unspecified() {
            return Err(Invalid::WildcardListen.into());
        }
        if let Some(moves) = &self.moves {
            if moves.listen.ip().is_unspecified() {
                return Err(Invalid::WildcardMovesListen.into());
            }
            if !matches!(self.storage.disks, DiskStorage::Zfs { .. }) {
                return Err(Invalid::MovesNeedZfs.into());
            }
        }
        if self.network.dns.is_empty() {
            return Err(Invalid::NoDns.into());
        }
        // 16384 /30s fit in the /16; names stay within IFNAMSIZ.
        if self.network.slots == 0 || self.network.slots > 16384 {
            return Err(Invalid::SlotCount.into());
        }
        if self.network.prefix.is_empty()
            || self.network.prefix.len() > 6
            || !self
                .network
                .prefix
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        {
            return Err(Invalid::NetworkPrefix.into());
        }
        // Clear of system users, nixbld (30000+) and the usual subuid ranges.
        if self.jail.uid_base < MINIMUM_UID_BASE {
            return Err(Invalid::UidBase.into());
        }
        if self.guest.concurrent_launches == 0 {
            return Err(Invalid::NoLaunches.into());
        }
        if self.tls.client_certificates.is_empty() {
            return Err(Invalid::NoClientCertificates.into());
        }
        Ok(())
    }
}

/// Users or groups holding an id the VMs would run as.
pub fn ids_taken(first: u32, count: u32) -> std::io::Result<Vec<String>> {
    let mut taken = Vec::new();
    for database in ["/etc/passwd", "/etc/group"] {
        let text = std::fs::read_to_string(database)?;
        for line in text.lines() {
            let mut fields = line.split(':');
            let name = fields.next().unwrap_or_default();
            let id = fields.nth(1).and_then(|id| id.parse::<u32>().ok());
            if let Some(id) = id
                && id >= first
                && id - first < count
            {
                taken.push(format!("{name} ({id}) in {database}"));
            }
        }
    }
    Ok(taken)
}
