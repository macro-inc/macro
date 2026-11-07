//! Computer-facing addresses resolved through the canonical service URL types.

use hosted_runtimes::domain::{
    enrollment::PersonaConfigKey,
    persona_credentials::{PersonaCredentialError, PersonaEnv},
};
use macro_service_urls::*;
use std::collections::BTreeMap;
use team_agents::domain::enrollment::EnrollmentEnvironment;

/// Typed endpoints resolved from the current deployment for a new enrollment.
pub struct ComputerUrls {
    /// Side-effect-free git preflight before either credential issuer runs.
    git: AgentGitServiceUrl,
    /// Computer-facing gateway endpoint.
    pub gateway: ApiGatewayUrl,
    /// Computer-facing egress endpoint.
    pub egress: AgentHarnessEgressUrl,
    /// Computer-facing storage endpoint.
    pub storage: DocumentStorageServiceUrl,
    /// Computer-facing auth endpoint.
    pub auth: AuthServiceUrl,
    /// Computer-facing cognition endpoint.
    pub cognition: DocumentCognitionServiceUrl,
    /// Computer-facing agent harness endpoint.
    pub agent_harness: AgentHarnessServiceUrl,
    /// Computer-facing scheduled action endpoint.
    pub scheduled_action: ScheduledActionServiceUrl,
    /// Computer-facing connection endpoint.
    pub connection: ConnectionGatewayWebsocketUrl,
    /// Computer-facing mcp endpoint.
    pub mcp: McpServiceUrl,
}

impl ComputerUrls {
    /// Resolve canonical service URLs, rejecting unreachable local guest endpoints when enabled.
    pub fn new(require_reachable: bool) -> anyhow::Result<Self> {
        let urls = Self {
            git: AgentGitServiceUrl::new()?,
            gateway: ApiGatewayUrl::new()?,
            egress: AgentHarnessEgressUrl::new()?,
            storage: DocumentStorageServiceUrl::new()?,
            auth: AuthServiceUrl::new()?,
            cognition: DocumentCognitionServiceUrl::new()?,
            agent_harness: AgentHarnessServiceUrl::new()?,
            scheduled_action: ScheduledActionServiceUrl::new()?,
            connection: ConnectionGatewayWebsocketUrl::new()?,
            mcp: McpServiceUrl::new()?,
        };
        urls.validate(require_reachable)?;
        Ok(urls)
    }

    fn validate(&self, require_reachable: bool) -> anyhow::Result<()> {
        for (name, raw, websocket) in [
            (
                AgentGitServiceUrl::OVERRIDE_ENV_VAR_NAME,
                self.git.as_str(),
                false,
            ),
            (
                ApiGatewayUrl::OVERRIDE_ENV_VAR_NAME,
                self.gateway.as_str(),
                false,
            ),
            (
                AgentHarnessEgressUrl::OVERRIDE_ENV_VAR_NAME,
                self.egress.as_str(),
                false,
            ),
            (
                DocumentStorageServiceUrl::OVERRIDE_ENV_VAR_NAME,
                self.storage.as_str(),
                false,
            ),
            (
                AuthServiceUrl::OVERRIDE_ENV_VAR_NAME,
                self.auth.as_str(),
                false,
            ),
            (
                DocumentCognitionServiceUrl::OVERRIDE_ENV_VAR_NAME,
                self.cognition.as_str(),
                false,
            ),
            (
                AgentHarnessServiceUrl::OVERRIDE_ENV_VAR_NAME,
                self.agent_harness.as_str(),
                false,
            ),
            (
                ScheduledActionServiceUrl::OVERRIDE_ENV_VAR_NAME,
                self.scheduled_action.as_str(),
                false,
            ),
            (
                ConnectionGatewayWebsocketUrl::OVERRIDE_ENV_VAR_NAME,
                self.connection.as_str(),
                true,
            ),
            (
                McpServiceUrl::OVERRIDE_ENV_VAR_NAME,
                self.mcp.as_str(),
                false,
            ),
        ] {
            let url = reqwest::Url::parse(raw)?;
            let host = url
                .host_str()
                .ok_or_else(|| anyhow::anyhow!("{name} needs a host"))?;
            let loopback = host.eq_ignore_ascii_case("localhost")
                || host.ends_with(".localhost")
                || host
                    .trim_matches(['[', ']'])
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|ip| ip.is_loopback() || ip.is_unspecified());
            let valid_protocol = if websocket {
                matches!(url.scheme(), "ws" | "wss")
            } else {
                matches!(url.scheme(), "http" | "https")
            };
            anyhow::ensure!(
                valid_protocol
                    && !(require_reachable && loopback)
                    && url.username().is_empty()
                    && url.password().is_none()
                    && url.query().is_none()
                    && url.fragment().is_none(),
                "{name} must be a computer-reachable service base URL without credentials, query or fragment"
            );
        }
        Ok(())
    }

    fn persona_env(&self) -> anyhow::Result<PersonaEnv> {
        self.validate(true)?;
        let mut values = BTreeMap::new();
        values.insert(
            PersonaConfigKey::parse(DocumentStorageServiceUrl::OVERRIDE_ENV_VAR_NAME)?,
            self.storage.as_str().trim_end_matches('/').to_owned(),
        );
        values.insert(
            PersonaConfigKey::parse(AuthServiceUrl::OVERRIDE_ENV_VAR_NAME)?,
            self.auth.as_str().trim_end_matches('/').to_owned(),
        );
        values.insert(
            PersonaConfigKey::parse(DocumentCognitionServiceUrl::OVERRIDE_ENV_VAR_NAME)?,
            self.cognition.as_str().trim_end_matches('/').to_owned(),
        );
        values.insert(
            PersonaConfigKey::parse(AgentHarnessServiceUrl::OVERRIDE_ENV_VAR_NAME)?,
            self.agent_harness.as_str().trim_end_matches('/').to_owned(),
        );
        values.insert(
            PersonaConfigKey::parse(ScheduledActionServiceUrl::OVERRIDE_ENV_VAR_NAME)?,
            self.scheduled_action
                .as_str()
                .trim_end_matches('/')
                .to_owned(),
        );
        values.insert(
            PersonaConfigKey::parse(ConnectionGatewayWebsocketUrl::OVERRIDE_ENV_VAR_NAME)?,
            self.connection.as_str().trim_end_matches('/').to_owned(),
        );
        values.insert(
            PersonaConfigKey::parse(McpServiceUrl::OVERRIDE_ENV_VAR_NAME)?,
            self.mcp.as_str().trim_end_matches('/').to_owned(),
        );
        values.insert(
            PersonaConfigKey::parse("MACRO_GATEWAY")?,
            self.gateway.as_str().trim_end_matches('/').to_owned(),
        );
        values.insert(
            PersonaConfigKey::parse("ANTHROPIC_BASE_URL")?,
            format!(
                "{}/brain/anthropic",
                self.egress.as_str().trim_end_matches('/')
            ),
        );
        Ok(PersonaEnv::new(values)?)
    }
}

impl EnrollmentEnvironment for ComputerUrls {
    fn environment(&self) -> Result<PersonaEnv, PersonaCredentialError> {
        // Never reuse startup addresses for a new enrollment or recreation.
        Self::new(true)
            .and_then(|urls| urls.persona_env())
            .map_err(|_| PersonaCredentialError::Unavailable)
    }
}

#[cfg(test)]
mod test;
