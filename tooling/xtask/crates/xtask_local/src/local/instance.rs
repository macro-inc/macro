//! Per-instance isolation: names, networks, volumes, and host ports.
//!
//! The default instance is named `macro` and keeps the exact resource names
//! and host ports the repo uses today, so existing worktrees and muscle memory
//! are untouched. A named instance (`--instance agent-a`) derives a disjoint
//! set of project name, networks, volumes, and a deterministic high port window
//! so two stacks can run concurrently without clobbering each other.

use std::net::TcpListener;

use anyhow::{Context, Result, bail};
use strum::{EnumIter, IntoEnumIterator};

use super::repo_root;

/// The reserved default instance name. Maps to today's frozen `macro` Compose
/// project and the fixed base ports.
pub const DEFAULT_NAME: &str = "macro";

/// Start of the non-default port window. Keep the entire allocation below
/// Linux's default ephemeral range (32768-60999), otherwise an ordinary
/// outbound connection can intermittently occupy a Compose host port.
const WINDOW_START: u32 = 20_000;
const STRIDE: u32 = 100;
const BUCKETS: u32 = 120; // 20000..=31999

/// A validated instance name: lowercase ASCII alphanumerics, hyphen, and
/// underscore, starting alphanumeric, non-empty, <= 40 chars. The newtype
/// guarantees every constructed name is a legal Docker resource-name component.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstanceName(String);

impl InstanceName {
    pub fn parse(raw: &str) -> Result<Self> {
        ensure_valid(raw)?;
        Ok(InstanceName(raw.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

fn ensure_valid(raw: &str) -> Result<()> {
    if raw.is_empty() {
        bail!("instance name must not be empty");
    }
    if raw.len() > 40 {
        bail!("instance name '{raw}' is too long (max 40 chars)");
    }
    let ok = raw.bytes().enumerate().all(|(i, b)| match b {
        b'a'..=b'z' | b'0'..=b'9' => true,
        b'-' | b'_' => i != 0,
        _ => false,
    });
    if !ok {
        bail!(
            "instance name '{raw}' must be lowercase [a-z0-9_-] and start with an alphanumeric \
             (so it yields valid Docker network/volume names)"
        );
    }
    Ok(())
}

/// Every host port the orchestrator allocates. The discriminant IS the port the
/// default `macro` instance binds (matching the values hardcoded in the compose
/// files today); a named instance binds `port_base + offset`, where `offset` is
/// the variant's position in declaration order. Adding a port is a single line:
/// `NewThing = 8099,`. Offsets stay below `STRIDE`, so named windows never
/// overlap.
#[derive(Clone, Copy, Debug, PartialEq, Eq, EnumIter)]
#[repr(u16)]
pub enum Port {
    Postgres = 5432,
    Redis = 6379,
    RedisUi = 8001,
    OpenSearch = 9200,
    OpenSearchPa = 9600,
    FusionAuth = 9011,
    LocalStack = 4566,
    MailpitSmtp = 1025,
    MailpitUi = 8025,
    Proxy = 8090,
    Frontend = 3000,
    Auth = 8080,
    ConnGateway = 8082,
    Contacts = 8083,
    DocCognition = 8085,
    DocStorage = 8086,
    Email = 8087,
    Notification = 8089,
    SearchProcessing = 8092,
    StaticFile = 8094,
    Unfurl = 8095,
    ImageProxy = 8097,
    Kafka = 9092,
    SdkWebhookSsh = 8788,
    SdkWebhookHostReceiver = 8789,
    // Appended (not slotted by number) so existing per-instance port offsets,
    // which come from declaration order, stay stable.
    /// Retired with agent_proxy_service; kept (in place, at the end) because
    /// per-instance port offsets come from declaration order, and removing a
    /// variant would shift every one declared after it.
    AgentProxy = 8091,
    /// Agent session control API.
    AgentHarness = 8101,
    /// The agent egress proxy, `agent_harness_service`'s second listener.
    /// Published on every local instance - it is what the Cursor egress
    /// tunnel points at, and Cursor's cloud is outside the compose network.
    AgentHarnessEgress = 8102,
}

impl Port {
    /// The port the default `macro` instance binds — the variant's discriminant.
    pub const fn fixed(self) -> u16 {
        self as u16
    }

    /// The per-port offset within a named instance's stride: the variant's
    /// position in declaration order. Unique and `< STRIDE` by construction
    /// (there are far fewer variants than the stride).
    pub fn offset(self) -> u16 {
        Port::iter()
            .position(|p| p == self)
            .expect("every Port is yielded by iter()") as u16
    }

    /// Every allocated port — used by doctor / collision probing / the env
    /// summary.
    pub fn all() -> impl Iterator<Item = Port> {
        Port::iter()
    }
}

/// A resolved instance: its identity plus the derived resource names and port
/// base. Construct with [`Instance::derive`].
#[derive(Clone, Debug)]
pub struct Instance {
    name: InstanceName,
    project_name: String,
    port_base: u16,
}

impl Instance {
    /// Derive the instance from the `--instance`/`--port-base` flags. `None`
    /// (or `--instance macro`) is the default instance.
    pub fn derive(instance: Option<&str>, port_base: Option<u16>) -> Result<Self> {
        let name = match instance {
            None | Some(DEFAULT_NAME) => InstanceName(DEFAULT_NAME.to_string()),
            Some(n) => InstanceName::parse(n)?,
        };
        let project_name = if name.as_str() == DEFAULT_NAME {
            DEFAULT_NAME.to_string()
        } else {
            format!("macro-{}", name.0)
        };
        let port_base = port_base.unwrap_or_else(|| derive_port_base(&name));
        Ok(Instance {
            name,
            project_name,
            port_base,
        })
    }

    pub fn name(&self) -> &str {
        self.name.as_str()
    }

    pub fn is_default(&self) -> bool {
        self.name.as_str() == DEFAULT_NAME
    }

    /// The Compose project name (`-p` / `COMPOSE_PROJECT_NAME`).
    pub fn project_name(&self) -> &str {
        &self.project_name
    }

    #[allow(dead_code)] // used by tests and diagnostics
    pub fn port_base(&self) -> u16 {
        self.port_base
    }

    /// The host port this instance binds for `port`.
    pub fn port(&self, port: Port) -> u16 {
        if self.is_default() {
            port.fixed()
        } else {
            self.port_base + port.offset()
        }
    }

    /// External `databases` network name.
    pub fn network_databases(&self) -> String {
        self.suffixed_dash("databases")
    }

    /// External `auth` network name.
    pub fn network_auth(&self) -> String {
        self.suffixed_dash("auth")
    }

    pub fn volume_postgres(&self) -> String {
        self.suffixed_underscore("macro_postgres_data")
    }

    pub fn volume_redis(&self) -> String {
        self.suffixed_underscore("macro_redis_data")
    }

    pub fn volume_opensearch(&self) -> String {
        self.suffixed_underscore("macro_opensearch_data")
    }

    pub fn volume_kafka(&self) -> String {
        self.suffixed_underscore("macro_kafka_data")
    }

    pub fn volume_fusionauth_db(&self) -> String {
        self.suffixed_underscore("fusionauth_db_data")
    }

    pub fn volume_fusionauth_config(&self) -> String {
        self.suffixed_underscore("fusionauth_config")
    }

    /// Where generated artifacts (compose override, env file, kickstart,
    /// Caddyfile, frontend env) live for this instance.
    pub fn artifact_dir(&self) -> std::path::PathBuf {
        repo_root()
            .join("infra/local/generated")
            .join(self.name.as_str())
    }

    fn suffixed_dash(&self, base: &str) -> String {
        if self.is_default() {
            base.to_string()
        } else {
            format!("{base}-{}", self.name.0)
        }
    }

    fn suffixed_underscore(&self, base: &str) -> String {
        if self.is_default() {
            base.to_string()
        } else {
            format!("{base}_{}", self.name.0)
        }
    }

    /// Probe every allocated host port with a TCP bind. Returns the host ports
    /// that are already in use. Advisory-only; surfaced as a warning in doctor.
    pub fn busy_ports(&self) -> Vec<u16> {
        Port::all()
            .filter_map(|p| {
                let host_port = self.port(p);
                match TcpListener::bind(("127.0.0.1", host_port)) {
                    Ok(_) => None,
                    Err(_) => Some(host_port),
                }
            })
            .collect()
    }

    /// Create the instance's generated-artifact directory.
    pub fn ensure_artifact_dir(&self) -> Result<std::path::PathBuf> {
        let dir = self.artifact_dir();
        std::fs::create_dir_all(&dir)
            .with_context(|| format!("creating artifact dir {}", dir.display()))?;
        Ok(dir)
    }
}

/// Deterministically derive a port base from the instance name with FNV-1a.
/// FNV is stable across machines and Rust versions (unlike `DefaultHasher`),
/// so two developers running `--instance agent-a` get the same ports.
fn derive_port_base(name: &InstanceName) -> u16 {
    (WINDOW_START + (fnv1a(name.as_str()) % BUCKETS) * STRIDE) as u16
}

fn fnv1a(s: &str) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for b in s.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

#[cfg(test)]
mod test;
