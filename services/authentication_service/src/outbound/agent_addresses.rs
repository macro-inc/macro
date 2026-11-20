//! The addresses an agent teammate's brain reaches Macro at, as its computer
//! sees them: each service's canonical URL type, resolved afresh for every
//! enrollment. Local stacks override them per fleet (`OVERRIDE_*`).

use macro_service_urls::{
    AgentHarnessEgressUrl, AgentHarnessServiceUrl, ApiGatewayUrl, AuthServiceUrl,
    ConnectionGatewayWebsocketUrl, DocumentCognitionServiceUrl, DocumentStorageServiceUrl,
    McpServiceUrl, ScheduledActionServiceUrl, TelemetryIntakeUrl,
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

/// Where the agent's spans go (OTLP/HTTP), the standard OTel variable.
pub const TELEMETRY_KEY: &str = "OTEL_EXPORTER_OTLP_ENDPOINT";

/// Resolves [`EnrollmentEnvironment`] from the service URL types.
pub struct AgentAddresses;

#[derive(Debug, thiserror::Error)]
#[error("{name} must be a computer-reachable URL without credentials, query or fragment")]
struct UnreachableAddress {
    name: &'static str,
}

fn is_loopback(url: &macro_service_urls::Url) -> bool {
    url.host_str().is_some_and(|host| {
        host.eq_ignore_ascii_case("localhost")
            || host.ends_with(".localhost")
            || host
                .trim_matches(['[', ']'])
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback() || ip.is_unspecified())
    })
}

fn checked(name: &'static str, raw: &str, websocket: bool) -> Result<String, TeamAgentError> {
    let invalid = || TeamAgentError::internal(UnreachableAddress { name });
    let url = macro_service_urls::Url::parse(raw).map_err(|_| invalid())?;
    let scheme_ok = if websocket {
        matches!(url.scheme(), "ws" | "wss")
    } else {
        matches!(url.scheme(), "http" | "https")
    };
    url.host_str().ok_or_else(invalid)?;
    if !scheme_ok
        || is_loopback(&url)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid());
    }
    Ok(raw.trim_end_matches('/').to_owned())
}

/// The agent's telemetry intake, or none when it is this machine's loopback,
/// which a computer can't reach (a local stack without a wired collector).
fn telemetry(raw: &str) -> Result<Option<(&'static str, String)>, TeamAgentError> {
    let url = macro_service_urls::Url::parse(raw).map_err(|_| {
        TeamAgentError::internal(UnreachableAddress {
            name: TELEMETRY_KEY,
        })
    })?;
    if is_loopback(&url) {
        return Ok(None);
    }
    Ok(Some((TELEMETRY_KEY, checked(TELEMETRY_KEY, raw, false)?)))
}

fn resolve() -> Result<Vec<(&'static str, String)>, TeamAgentError> {
    let storage = DocumentStorageServiceUrl::new().map_err(TeamAgentError::internal)?;
    let auth = AuthServiceUrl::new().map_err(TeamAgentError::internal)?;
    let cognition = DocumentCognitionServiceUrl::new().map_err(TeamAgentError::internal)?;
    let harness = AgentHarnessServiceUrl::new().map_err(TeamAgentError::internal)?;
    let scheduled = ScheduledActionServiceUrl::new().map_err(TeamAgentError::internal)?;
    let connection = ConnectionGatewayWebsocketUrl::new().map_err(TeamAgentError::internal)?;
    let mcp = McpServiceUrl::new().map_err(TeamAgentError::internal)?;
    let gateway = ApiGatewayUrl::new().map_err(TeamAgentError::internal)?;
    let egress = AgentHarnessEgressUrl::new().map_err(TeamAgentError::internal)?;
    let egress = checked(AgentHarnessEgressUrl::OVERRIDE_ENV_VAR_NAME, &egress, false)?;
    let intake = TelemetryIntakeUrl::new().map_err(TeamAgentError::internal)?;
    let telemetry = telemetry(&intake)?;
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
    ]
    .into_iter()
    .chain(telemetry)
    .collect())
}

impl EnrollmentEnvironment for AgentAddresses {
    fn environment(&self) -> Result<Vec<(&'static str, String)>, TeamAgentError> {
        resolve()
    }
}
