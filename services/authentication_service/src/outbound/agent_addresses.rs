//! The addresses an agent teammate's brain reaches Macro at: each service's
//! canonical URL type, resolved afresh for every enrollment.
//!
//! - [`AgentAddresses`]: as a Macro computer sees them. Local stacks
//!   override them per fleet (`OVERRIDE_*`).
//! - [`PublicAgentAddresses`]: as an owner's own machine sees them, the
//!   environment's public defaults, never a fleet's override.

use macro_service_urls::macro_env::Environment;
use macro_service_urls::{
    AgentHarnessEgressUrl, AgentHarnessServiceUrl, ApiGatewayUrl, AuthServiceUrl,
    ConnectionGatewayWebsocketUrl, DocumentCognitionServiceUrl, DocumentStorageServiceUrl,
    McpServiceUrl, ScheduledActionServiceUrl,
};
use team_agents::domain::{models::TeamAgentError, ports::EnrollmentEnvironment};

#[cfg(test)]
mod test;

/// The public gateway origin the brain's SDK calls.
pub const GATEWAY_KEY: &str = "MACRO_GATEWAY";
/// Macro's Anthropic gateway for brains, on the harness's egress listener.
pub const ANTHROPIC_BASE_URL_KEY: &str = "ANTHROPIC_BASE_URL";
/// Macro's call speech gateway for brains, on the same listener: the
/// runtime opens `ws(s)://…/stt` and `…/tts` under it.
pub const SPEECH_URL_KEY: &str = "MACRO_SPEECH_URL";

/// Resolves [`EnrollmentEnvironment`] from the service URL types.
pub struct AgentAddresses;

#[derive(Debug, thiserror::Error)]
#[error("{name} must be a computer-reachable URL without credentials, query or fragment")]
struct UnreachableAddress {
    name: &'static str,
}

#[cfg(test)]
fn checked(name: &'static str, raw: &str, websocket: bool) -> Result<String, TeamAgentError> {
    checked_allowing(name, raw, websocket, false)
}

/// `raw` trimmed, if it is a reachable URL without credentials, query or
/// fragment. A loopback host passes only when `loopback_ok` (a local stack
/// whose own machine runs the teammate).
fn checked_allowing(
    name: &'static str,
    raw: &str,
    websocket: bool,
    loopback_ok: bool,
) -> Result<String, TeamAgentError> {
    let invalid = || TeamAgentError::internal(UnreachableAddress { name });
    let url = macro_service_urls::Url::parse(raw).map_err(|_| invalid())?;
    let scheme_ok = if websocket {
        matches!(url.scheme(), "ws" | "wss")
    } else {
        matches!(url.scheme(), "http" | "https")
    };
    let host = url.host_str().ok_or_else(invalid)?;
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host.ends_with(".localhost")
        || host
            .trim_matches(['[', ']'])
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback() || ip.is_unspecified());
    if !scheme_ok
        || (loopback && !loopback_ok)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid());
    }
    Ok(raw.trim_end_matches('/').to_owned())
}

/// The service URLs, before they are checked.
struct ServiceUrls {
    storage: String,
    auth: String,
    cognition: String,
    harness: String,
    scheduled: String,
    connection: String,
    mcp: String,
    gateway: String,
    egress: String,
}

/// As a Macro computer reaches them: the process's URLs, overrides included.
fn computer_facing() -> Result<ServiceUrls, TeamAgentError> {
    Ok(ServiceUrls {
        storage: DocumentStorageServiceUrl::new()
            .map_err(TeamAgentError::internal)?
            .to_string(),
        auth: AuthServiceUrl::new()
            .map_err(TeamAgentError::internal)?
            .to_string(),
        cognition: DocumentCognitionServiceUrl::new()
            .map_err(TeamAgentError::internal)?
            .to_string(),
        harness: AgentHarnessServiceUrl::new()
            .map_err(TeamAgentError::internal)?
            .to_string(),
        scheduled: ScheduledActionServiceUrl::new()
            .map_err(TeamAgentError::internal)?
            .to_string(),
        connection: ConnectionGatewayWebsocketUrl::new()
            .map_err(TeamAgentError::internal)?
            .to_string(),
        mcp: McpServiceUrl::new()
            .map_err(TeamAgentError::internal)?
            .to_string(),
        gateway: ApiGatewayUrl::new()
            .map_err(TeamAgentError::internal)?
            .to_string(),
        egress: AgentHarnessEgressUrl::new()
            .map_err(TeamAgentError::internal)?
            .to_string(),
    })
}

/// As anyone on the internet reaches them: the environment's defaults.
fn public(environment: Environment) -> ServiceUrls {
    ServiceUrls {
        storage: DocumentStorageServiceUrl::default_for_environment(environment).to_string(),
        auth: AuthServiceUrl::default_for_environment(environment).to_string(),
        cognition: DocumentCognitionServiceUrl::default_for_environment(environment).to_string(),
        harness: AgentHarnessServiceUrl::default_for_environment(environment).to_string(),
        scheduled: ScheduledActionServiceUrl::default_for_environment(environment).to_string(),
        connection: ConnectionGatewayWebsocketUrl::default_for_environment(environment).to_string(),
        mcp: McpServiceUrl::default_for_environment(environment).to_string(),
        gateway: ApiGatewayUrl::default_for_environment(environment).to_string(),
        egress: AgentHarnessEgressUrl::default_for_environment(environment).to_string(),
    }
}

fn resolve() -> Result<Vec<(&'static str, String)>, TeamAgentError> {
    environment(computer_facing()?, false)
}

/// The brain's variables from `urls`, each checked.
fn environment(
    urls: ServiceUrls,
    loopback_ok: bool,
) -> Result<Vec<(&'static str, String)>, TeamAgentError> {
    let checked = |name, raw: &str, websocket| checked_allowing(name, raw, websocket, loopback_ok);
    let ServiceUrls {
        storage,
        auth,
        cognition,
        harness,
        scheduled,
        connection,
        mcp,
        gateway,
        egress,
    } = urls;
    let egress = checked(AgentHarnessEgressUrl::OVERRIDE_ENV_VAR_NAME, &egress, false)?;
    Ok(vec![
        (
            DocumentStorageServiceUrl::OVERRIDE_ENV_VAR_NAME,
            checked(
                DocumentStorageServiceUrl::OVERRIDE_ENV_VAR_NAME,
                &storage,
                false,
            )?,
        ),
        (
            AuthServiceUrl::OVERRIDE_ENV_VAR_NAME,
            checked(AuthServiceUrl::OVERRIDE_ENV_VAR_NAME, &auth, false)?,
        ),
        (
            DocumentCognitionServiceUrl::OVERRIDE_ENV_VAR_NAME,
            checked(
                DocumentCognitionServiceUrl::OVERRIDE_ENV_VAR_NAME,
                &cognition,
                false,
            )?,
        ),
        (
            AgentHarnessServiceUrl::OVERRIDE_ENV_VAR_NAME,
            checked(
                AgentHarnessServiceUrl::OVERRIDE_ENV_VAR_NAME,
                &harness,
                false,
            )?,
        ),
        (
            ScheduledActionServiceUrl::OVERRIDE_ENV_VAR_NAME,
            checked(
                ScheduledActionServiceUrl::OVERRIDE_ENV_VAR_NAME,
                &scheduled,
                false,
            )?,
        ),
        (
            ConnectionGatewayWebsocketUrl::OVERRIDE_ENV_VAR_NAME,
            checked(
                ConnectionGatewayWebsocketUrl::OVERRIDE_ENV_VAR_NAME,
                &connection,
                true,
            )?,
        ),
        (
            McpServiceUrl::OVERRIDE_ENV_VAR_NAME,
            checked(McpServiceUrl::OVERRIDE_ENV_VAR_NAME, &mcp, false)?,
        ),
        (GATEWAY_KEY, checked(GATEWAY_KEY, &gateway, false)?),
        (ANTHROPIC_BASE_URL_KEY, format!("{egress}/brain/anthropic")),
        (SPEECH_URL_KEY, format!("{egress}/brain/inference")),
    ])
}

impl EnrollmentEnvironment for AgentAddresses {
    fn environment(&self) -> Result<Vec<(&'static str, String)>, TeamAgentError> {
        resolve()
    }
}

/// Resolves [`EnrollmentEnvironment`] for an owner's own machine: the
/// environment's public addresses. A local stack's are loopback, for a
/// teammate run on the same machine.
pub struct PublicAgentAddresses(pub Environment);

impl EnrollmentEnvironment for PublicAgentAddresses {
    fn environment(&self) -> Result<Vec<(&'static str, String)>, TeamAgentError> {
        environment(public(self.0), matches!(self.0, Environment::Local))
    }
}
