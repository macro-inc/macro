//! Computer-facing addresses, distinct from the host/browser service overrides.

use std::collections::BTreeMap;

use macro_env::Environment;
use macro_service_urls::{AgentGitServiceUrl, AgentHarnessEgressUrl, ApiGatewayUrl};

/// Addresses the enrolled brain must be able to dial from its own machine.
pub struct ComputerUrls {
    /// Macro SDK gateway origin.
    pub gateway: String,
    /// Harness egress listener, before the Anthropic route suffix.
    pub egress: String,
    /// Git smart-HTTP base advertised to the computer.
    pub git: String,
}

impl ComputerUrls {
    /// Resolves the same local override map used for macrod enrollment.
    /// Deployed environments use the existing typed public service URLs.
    pub fn new(
        environment: Environment,
        fleet_enabled: bool,
        overrides: Option<&str>,
    ) -> anyhow::Result<Self> {
        let overrides = match overrides {
            Some(raw) if matches!(environment, Environment::Local) => {
                serde_json::from_str::<BTreeMap<String, String>>(raw)?
            }
            Some(_) => anyhow::bail!("COMPUTERS_SERVICE_URL_OVERRIDES is local-only"),
            None => BTreeMap::new(),
        };
        let defaults = Self {
            gateway: ApiGatewayUrl::new()?.to_string(),
            egress: AgentHarnessEgressUrl::new()?.to_string(),
            git: AgentGitServiceUrl::new()?.to_string(),
        };
        Self::from_defaults(environment, fleet_enabled, &overrides, defaults)
    }

    fn from_defaults(
        environment: Environment,
        fleet_enabled: bool,
        overrides: &BTreeMap<String, String>,
        defaults: Self,
    ) -> anyhow::Result<Self> {
        // No local computer can consume these addresses when the fleet is off.
        if matches!(environment, Environment::Local) && !fleet_enabled && overrides.is_empty() {
            return Ok(defaults);
        }
        if matches!(environment, Environment::Local) {
            for name in [
                "OVERRIDE_API_GATEWAY_URL",
                "OVERRIDE_AGENT_HARNESS_EGRESS_URL",
                "OVERRIDE_AGENT_GIT_SERVICE_URL",
            ] {
                if !overrides.contains_key(name) {
                    anyhow::bail!(
                        "COMPUTERS_SERVICE_URL_OVERRIDES needs {name}; regenerate the local computer environment"
                    );
                }
            }
        }
        Self::resolve(overrides, defaults)
    }

    fn resolve(overrides: &BTreeMap<String, String>, defaults: Self) -> anyhow::Result<Self> {
        let pick = |name, default| -> anyhow::Result<String> {
            let raw = overrides.get(name).cloned().unwrap_or(default);
            let url = reqwest::Url::parse(&raw)?;
            let host = url
                .host_str()
                .ok_or_else(|| anyhow::anyhow!("{name} needs a host"))?;
            let loopback = host.eq_ignore_ascii_case("localhost")
                || host.ends_with(".localhost")
                || host
                    .trim_matches(['[', ']'])
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|ip| ip.is_loopback() || ip.is_unspecified());
            if !matches!(url.scheme(), "http" | "https")
                || loopback
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
            {
                anyhow::bail!(
                    "{name} must be a computer-reachable HTTP(S) base URL without credentials, query or fragment"
                );
            }
            Ok(raw.trim_end_matches('/').to_string())
        };
        Ok(Self {
            gateway: pick("OVERRIDE_API_GATEWAY_URL", defaults.gateway)?,
            egress: pick("OVERRIDE_AGENT_HARNESS_EGRESS_URL", defaults.egress)?,
            git: pick("OVERRIDE_AGENT_GIT_SERVICE_URL", defaults.git)?,
        })
    }
}

#[cfg(test)]
mod test;
