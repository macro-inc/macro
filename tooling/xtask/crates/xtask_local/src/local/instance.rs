//! Per-instance isolation: names, networks, volumes, and host ports.
//!
//! The default instance is named `macro` and keeps the exact resource names
//! and host ports the repo uses today, so existing worktrees and muscle memory
//! are untouched. A named instance (`--instance agent-a`) derives a disjoint
//! set of project name, networks, and volumes. Its port window and Docker
//! subnet come from [`super::allocator`], so concurrent stacks can't collide.

use anyhow::{Context, Result, bail};
pub use xtask_ports::Port;

use super::{allocator, repo_root};

/// The reserved default instance name. Maps to today's frozen `macro` Compose
/// project and the fixed base ports.
pub const DEFAULT_NAME: &str = xtask_ports::DEFAULT_INSTANCE;

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

/// A resolved instance: its identity plus the derived resource names and port
/// base. Construct with [`Instance::derive`].
#[derive(Clone, Debug)]
pub struct Instance {
    name: InstanceName,
    project_name: String,
    port_base: u16,
    subnet_block: Option<u8>,
}

impl Instance {
    /// Find an instance a command acts on without starting it: the window its
    /// containers or allocation hold, so no `--port-base` needs repeating.
    pub fn resolve(instance: Option<&str>, port_base: Option<u16>) -> Result<Self> {
        Ok(allocator::resolve(
            Self::derive(instance, port_base)?,
            port_base.is_some(),
        ))
    }

    /// Derive the instance from the `--instance`/`--port-base` flags, with the
    /// name's hashed window. `None` (or `--instance macro`) is the default
    /// instance. Start flows use [`allocator::allocate`], other commands
    /// [`Instance::resolve`].
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
        let port_base = port_base.unwrap_or_else(|| xtask_ports::hashed_window(name.as_str()));
        Ok(Instance {
            name,
            project_name,
            port_base,
            subnet_block: None,
        })
    }

    /// This instance on an allocated port window and subnet block.
    pub(super) fn with_allocation(self, port_base: u16, subnet_block: Option<u8>) -> Self {
        Instance {
            port_base,
            subnet_block,
            ..self
        }
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

    /// The `services` network's Docker name.
    pub fn network_services(&self) -> String {
        format!("{}_services", self.project_name)
    }

    /// The FusionAuth `auth-internal` network's Docker name.
    pub fn network_auth_internal(&self) -> String {
        format!("{}_auth-internal", self.project_name)
    }

    /// The networks this instance creates itself, each with the subnet its
    /// allocation assigns. The default instance's `services` and `auth-internal`
    /// stay Compose-managed: the machine-wide collectors share `macro_services`.
    pub fn networks(&self) -> Vec<(String, Option<String>)> {
        let mut names = vec![self.network_databases(), self.network_auth()];
        if !self.is_default() {
            names.push(self.network_services());
            names.push(self.network_auth_internal());
        }
        names
            .into_iter()
            .enumerate()
            .map(|(index, name)| {
                let subnet = self
                    .subnet_block
                    .map(|block| xtask_ports::network_subnet(block, index));
                (name, subnet)
            })
            .collect()
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

    /// Create the instance's generated-artifact directory.
    pub fn ensure_artifact_dir(&self) -> Result<std::path::PathBuf> {
        let dir = self.artifact_dir();
        std::fs::create_dir_all(&dir)
            .with_context(|| format!("creating artifact dir {}", dir.display()))?;
        Ok(dir)
    }
}

#[cfg(test)]
mod test;
