//! Hosts: what each one holds, how it registers, and how the control plane
//! reaches it.

use crate::domain::lifecycle::HostId;

/// A host's unique name, as its row and its agent know it: 1 to 63 ASCII
/// letters, digits, `.`, `_` or `-`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct HostName(String);

/// A name that cannot be a host's.
#[derive(Debug, thiserror::Error)]
#[error("a host name is 1 to 63 ASCII letters, digits, '.', '_' or '-'")]
pub struct InvalidHostName;

impl HostName {
    /// Validate a host name.
    pub fn try_new(value: &str) -> Result<Self, InvalidHostName> {
        if value.is_empty()
            || value.len() > 63
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        {
            return Err(InvalidHostName);
        }
        Ok(Self(value.to_owned()))
    }

    /// The name.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for HostName {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// A fleet host, counted in resource units.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Host {
    /// Stable resource identity.
    pub id: HostId,
    /// Unique name.
    pub name: HostName,
    /// Units available for awake guests.
    pub awake_capacity_units: u32,
    /// Units available for purchase.
    pub sold_capacity_units: u32,
}

/// What a host's reservations and computers hold against its capacity, with
/// the same holdings `ComputerRepo::reserve` counts: every reservation and
/// every computer until release, running or stopped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostAllocation {
    /// The host and its capacity.
    pub host: Host,
    /// Units held against [`Host::sold_capacity_units`].
    pub sold_units: u32,
    /// Virtual CPUs sold on the host.
    pub vcpus: u32,
    /// Memory in GiB sold on the host.
    pub memory_gib: u32,
    /// Root disk in GiB sold on the host.
    pub disk_gib: u32,
}

impl HostAllocation {
    /// Whether a computer of `units` fits on the host while awake.
    pub fn runs(&self, units: u32) -> bool {
        units <= self.host.awake_capacity_units
    }

    /// Whether the host can sell a computer of `units`: it runs it and has
    /// that much sold capacity left, as `ComputerRepo::reserve` decides.
    pub fn sells(&self, units: u32) -> bool {
        self.runs(units) && self.sold_units + units <= self.host.sold_capacity_units
    }
}

/// What a host reports when it registers: its hardware. How far it may be
/// overcommitted is its row's own settings
/// ([`crate::domain::overcommit::OvercommitPolicy`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostRegistration {
    /// Unique name.
    pub name: HostName,
    /// Logical CPUs.
    pub vcpus: u32,
    /// Memory in GiB.
    pub memory_gb: u32,
}

/// How the control plane reaches a Firecracker host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostConnection {
    /// The host agent's base URL.
    pub endpoint: url::Url,
    /// The host agent's self-signed certificate, pinned by the client.
    pub server_certificate_pem: String,
}

/// A host row, as the operator drives it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostRecord {
    /// Stable resource identity.
    pub id: HostId,
    /// Unique name.
    pub name: HostName,
    /// Where its agent is: every Firecracker host has one; `None` for the
    /// local Docker host its control plane's environment configures.
    pub connection: Option<HostConnection>,
    /// How many of its fleet effects (creates, starts) run at once.
    pub max_concurrent_starts: u32,
}
