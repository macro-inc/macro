use crate::{ImageAlias, InstanceName, ProfileName, StoragePoolName};
use std::time::Duration;

/// Explicit Incus transport and operation limits.
#[derive(Debug, Clone)]
pub struct IncusTimeouts {
    /// Deadline for each HTTP request.
    pub request: Duration,
    /// Deadline for establishing a connection.
    pub connect: Duration,
    /// Seconds each operation wait blocks server-side.
    pub operation_wait_secs: u32,
    /// Server-side state change deadline, in seconds.
    pub state_change_secs: u32,
    /// Maximum number of operation wait calls.
    pub operation_waits: u32,
}

use std::collections::BTreeMap;

use strum::{AsRefStr, EnumString};

/// Where the client connects and the TLS material it trusts and presents.
#[derive(Clone)]
pub struct IncusEndpoint {
    /// Base URL, e.g. `https://10.200.0.2:8443`.
    pub url: String,
    /// Explicit transport and operation deadlines.
    pub timeouts: IncusTimeouts,
    /// PEM certificate the server has in its trust store.
    pub client_cert_pem: String,
    /// PEM private key for `client_cert_pem`.
    pub client_key_pem: String,
    /// PEM of the server's own (self-signed) certificate; the only one accepted.
    pub server_cert_pem: String,
}

impl std::fmt::Debug for IncusEndpoint {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("IncusEndpoint")
            .field("url", &self.url)
            .finish_non_exhaustive()
    }
}

/// Container or virtual machine; serialised as Incus's instance `type`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumString, AsRefStr)]
#[strum(serialize_all = "kebab-case")]
pub enum InstanceKind {
    /// A system container.
    Container,
    /// A QEMU virtual machine.
    VirtualMachine,
}

/// Which image an instance is created from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImageReference {
    /// An alias such as `macro-box/2026-11-10`.
    Alias(ImageAlias),
    /// A full image fingerprint.
    Fingerprint(String),
}

/// Protocol of a remote image server.
#[derive(Debug, Clone, Copy, PartialEq, Eq, AsRefStr)]
#[strum(serialize_all = "lowercase")]
pub enum ImageProtocol {
    /// A simplestreams image server such as `https://images.linuxcontainers.org`.
    Simplestreams,
}

/// A remote image server Incus downloads the image from (and caches).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageRemote {
    /// Server URL.
    pub server: String,
    /// Server protocol.
    pub protocol: ImageProtocol,
}

/// The image an instance is created from. Without `remote`, the image must
/// already be in the host's image store.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageSource {
    /// Alias or fingerprint.
    pub reference: ImageReference,
    /// Remote server to fetch it from.
    pub remote: Option<ImageRemote>,
}

/// Override of the root disk the profiles provide.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RootDisk {
    /// Storage pool, which Incus requires on a root device override.
    pub pool: StoragePoolName,
    /// Size such as `40GiB`.
    pub size: String,
}

/// A new instance.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateInstance {
    /// Instance name (a hostname-like label).
    pub name: InstanceName,
    /// Image to create it from.
    pub image: ImageSource,
    /// Container or VM.
    pub kind: InstanceKind,
    /// Profiles applied in order.
    pub profiles: Vec<ProfileName>,
    /// Instance config such as `limits.cpu`, `limits.memory`, `user.*`.
    pub config: BTreeMap<String, String>,
    /// Root disk override.
    pub root_disk: Option<RootDisk>,
}

/// Run state of an instance, from Incus's status code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InstanceStatus {
    /// 103.
    Running,
    /// 102.
    Stopped,
    /// 106.
    Starting,
    /// 107.
    Stopping,
    /// 108.
    Aborting,
    /// 112.
    Error,
    /// A code this client does not model, with Incus's status text.
    Unknown {
        /// Incus status code.
        code: i64,
        /// Incus status text.
        status: String,
    },
}

impl InstanceStatus {
    pub(crate) fn from_incus(code: i64, status: String) -> Self {
        match code {
            102 => InstanceStatus::Stopped,
            103 => InstanceStatus::Running,
            106 => InstanceStatus::Starting,
            107 => InstanceStatus::Stopping,
            108 => InstanceStatus::Aborting,
            112 => InstanceStatus::Error,
            code => InstanceStatus::Unknown { code, status },
        }
    }
}

/// An instance as Incus reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstanceInfo {
    /// Instance name.
    pub name: String,
    /// Run state.
    pub status: InstanceStatus,
    /// Container or VM.
    pub kind: InstanceKind,
    /// The instance's own config (not expanded with profiles).
    pub config: BTreeMap<String, String>,
    /// Instance device overrides, including root volume limits.
    pub devices: BTreeMap<String, BTreeMap<String, String>>,
}

/// Live resource usage of a running instance.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InstanceUsage {
    /// Memory in use, in bytes.
    pub memory_usage_bytes: i64,
    /// CPU time consumed, in nanoseconds.
    pub cpu_usage_nanoseconds: i64,
}

/// Host capacity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HostResources {
    /// Total memory, in bytes.
    pub memory_total_bytes: u64,
    /// Memory in use, in bytes.
    pub memory_used_bytes: u64,
    /// CPU threads across all sockets.
    pub cpu_threads: u64,
}

/// Whether the server trusts our client certificate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumString)]
#[strum(serialize_all = "lowercase")]
pub enum ServerAuth {
    /// Our certificate is in the trust store.
    Trusted,
    /// It is not; only public endpoints work.
    Untrusted,
}

/// `GET /1.0`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerInfo {
    /// Trust state of our certificate.
    pub auth: ServerAuth,
    /// REST API version, e.g. `1.0`.
    pub api_version: String,
    /// Host name of the server.
    pub server_name: Option<String>,
    /// Incus version, e.g. `7.0.1`.
    pub server_version: Option<String>,
}

/// An image in the host's image store.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageInfo {
    /// Full fingerprint.
    pub fingerprint: String,
    /// Alias names pointing at it.
    pub aliases: Vec<ImageAlias>,
    /// Container or VM image.
    pub kind: InstanceKind,
    /// Size in bytes.
    pub size_bytes: i64,
}

/// A local image alias.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageAliasInfo {
    /// Alias name.
    pub name: ImageAlias,
    /// Fingerprint the alias points at.
    pub target_fingerprint: String,
    /// Container or VM image.
    pub kind: InstanceKind,
}
