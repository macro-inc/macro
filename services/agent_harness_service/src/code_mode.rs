//! Composition of code execution credentials with the harness's owner approval gate.
use agent_code_mode::domain::{
    CodeModeError, ExecutionCredentials, ExecutionIdentity, UserExecutionCredentials,
};
use agent_egress::outbound::macro_mcp::MacroApiTokenSigner;
use agent_inmem::domain::tool_gate::{NativeToolGate, NativeToolVerdict};
use async_trait::async_trait;
use code_execution::domain::RunEnvironment;
use macro_user_id::user_id::MacroUserIdStr;
use std::{collections::BTreeMap, sync::Arc};
use tokio_util::sync::CancellationToken;

pub struct RunCredentials {
    pub signer: MacroApiTokenSigner,
    pub gate: Arc<dyn NativeToolGate>,
    pub hosts: BTreeMap<String, String>,
}

#[async_trait]
impl ExecutionCredentials for RunCredentials {
    async fn issue(
        &self,
        identity: &ExecutionIdentity,
        source: &str,
        cancel: CancellationToken,
    ) -> Result<RunEnvironment, CodeModeError> {
        let actor = approve_run(self.gate.as_ref(), identity, source, &cancel).await?;
        // No refresh credential. Covers the 30-second queue/run deadline plus
        // clock margin; a normal user token expires rather than revoking on exit.
        let token = self
            .signer
            .mint_for_agent(&actor, 60, Some(identity.agent_id.as_uuid()))
            .await
            .map_err(|error| {
                tracing::error!(?error, "could not mint execution credential");
                CodeModeError::Unavailable
            })?;
        Ok(RunEnvironment {
            token,
            trace_headers: trace_headers(),
            hosts: self.hosts.clone(),
            session_id: Some(identity.session.as_uuid()),
            execution_id: Some(identity.execution.as_uuid()),
        })
    }
}

/// Credentials for public MCP runs: the signed-in user, with no session or agent.
/// The MCP client asks the user before each tool call, so there is no owner gate.
pub struct UserRunCredentials {
    pub signer: MacroApiTokenSigner,
    pub hosts: BTreeMap<String, String>,
}

#[async_trait]
impl UserExecutionCredentials for UserRunCredentials {
    async fn issue(&self, user: &MacroUserIdStr<'static>) -> Result<RunEnvironment, CodeModeError> {
        // Same lifetime as session runs: the 30-second deadline plus clock margin.
        let token = self.signer.mint_for(user, 60).await.map_err(|error| {
            tracing::error!(?error, "could not mint execution credential");
            CodeModeError::Unavailable
        })?;
        Ok(RunEnvironment {
            token,
            trace_headers: trace_headers(),
            hosts: self.hosts.clone(),
            session_id: None,
            execution_id: None,
        })
    }
}

/// The current trace context, for the SDK to forward on authenticated requests.
fn trace_headers() -> BTreeMap<String, String> {
    let mut headers = axum::http::HeaderMap::new();
    macro_tower_layers::inject_trace_headers(&mut headers);
    headers
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.to_string(), value.to_owned()))
        })
        .collect()
}

macro_env_var::env_var! { struct DocumentStorageServiceCloudfrontDistributionUrl; }

pub fn sdk_hosts() -> anyhow::Result<BTreeMap<String, String>> {
    use macro_service_urls::*;
    let storage = DocumentStorageServiceUrl::new()?.to_string();
    Ok([
        (
            "document-content",
            DocumentStorageServiceCloudfrontDistributionUrl::new()?.to_string(),
        ),
        ("static-content", StaticFilePublicUrl::new()?.to_string()),
        ("storage", storage.clone()),
        ("search", storage.clone()),
        ("properties", storage),
        ("auth", AuthServiceUrl::new()?.to_string()),
        ("agent-harness", AgentHarnessServiceUrl::new()?.to_string()),
        ("email", EmailServiceUrl::new()?.to_string()),
        ("calendar", CalendarServiceUrl::new()?.to_string()),
        ("cognition", DocumentCognitionServiceUrl::new()?.to_string()),
        ("notification", NotificationServiceUrl::new()?.to_string()),
        (
            "scheduled-action",
            ScheduledActionServiceUrl::new()?.to_string(),
        ),
        ("static-files", StaticFileServiceUrl::new()?.to_string()),
        ("connection", ConnectionGatewayUrl::new()?.to_string()),
        ("contacts", ContactsServiceUrl::new()?.to_string()),
        ("unfurl", UnfurlServiceUrl::new()?.to_string()),
    ]
    .into_iter()
    .map(|(name, url)| (name.into(), url))
    .collect())
}

pub mod reviews;

async fn approve_run(
    gate: &dyn NativeToolGate,
    identity: &ExecutionIdentity,
    source: &str,
    cancel: &CancellationToken,
) -> Result<macro_user_id::user_id::MacroUserIdStr<'static>, CodeModeError> {
    let args = serde_json::json!({"source": source, "acting_as": identity.acting_as, "turn_id": identity.turn});
    let verdict = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(CodeModeError::Forbidden),
        verdict = async { gate.check(identity.session, "ExecuteCode", &args).await } => verdict,
    };
    match verdict {
        NativeToolVerdict::Run => Err(CodeModeError::Forbidden),
        NativeToolVerdict::RunAs(actor) => Ok(actor),
        NativeToolVerdict::Refuse(message) => Err(CodeModeError::Invalid(message)),
    }
}
#[cfg(test)]
mod test;
