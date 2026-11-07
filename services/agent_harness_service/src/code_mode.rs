//! Composition of code execution credentials with the harness's owner approval gate.
use agent_code_mode::domain::{
    CodeModeError, ExecutionCredentials, ExecutionIdentity, UserExecutionCredentials,
};
use agent_correlation::domain::CorrelationRepository;
use agent_egress::outbound::macro_mcp::MacroApiTokenSigner;
use agent_inmem::domain::tool_gate::{NativeToolGate, NativeToolVerdict};
use async_trait::async_trait;
use code_execution::domain::{RunEnvironment, SdkEndpoints};
use macro_user_id::user_id::MacroUserIdStr;
use std::{collections::BTreeMap, sync::Arc};
use tokio_util::sync::CancellationToken;

pub struct RunCredentials {
    pub signer: MacroApiTokenSigner,
    pub correlations: agent_correlation::outbound::PgCorrelationRepository,
    pub gate: Arc<dyn NativeToolGate>,
    pub endpoints: SdkEndpoints,
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
        let correlation = self
            .correlations
            .create(identity.session.as_uuid(), identity.agent_id.as_uuid())
            .await
            .map_err(|error| {
                tracing::error!(?error, "could not persist code-mode correlation");
                CodeModeError::Unavailable
            })?;
        // No refresh credential. Covers the 30-second queue/run deadline plus
        // clock margin; a normal user token expires rather than revoking on exit.
        let token = self
            .signer
            .mint_for_agent(
                &actor,
                60,
                Some(identity.agent_id.as_uuid()),
                None,
                None,
                Some(correlation),
            )
            .await
            .map_err(|error| {
                tracing::error!(?error, "could not mint execution credential");
                CodeModeError::Unavailable
            })?;
        Ok(RunEnvironment {
            token,
            trace_headers: trace_headers(),
            endpoints: self.endpoints.clone(),
            session_id: Some(identity.session.as_uuid()),
            execution_id: Some(identity.execution.as_uuid()),
            unattended: None,
        })
    }
}

/// Credentials for public MCP runs: the signed-in user, with no session, and
/// the agent the run's posts are attributed to: an agent caller (a self-hosted
/// agent's call through egress) as itself, any other caller as the Macro bot,
/// labelled with the MCP client's name - the same attribution the direct MCP
/// tools give. The MCP client asks the user before each tool call, so there is
/// no owner gate.
pub struct UserRunCredentials {
    pub signer: MacroApiTokenSigner,
    pub correlations: agent_correlation::outbound::PgCorrelationRepository,
    pub endpoints: SdkEndpoints,
}

#[async_trait]
impl UserExecutionCredentials for UserRunCredentials {
    async fn issue(
        &self,
        user: &MacroUserIdStr<'static>,
        caller: &ai_toolset::ToolCaller,
        session: Option<uuid::Uuid>,
    ) -> Result<RunEnvironment, CodeModeError> {
        let agent = match caller {
            ai_toolset::ToolCaller::Agent(agent) => *agent,
            ai_toolset::ToolCaller::McpClient { .. } | ai_toolset::ToolCaller::ApiKey => {
                bot_id::MACRO_AI_BOT_ID
            }
        };
        let correlation = match session {
            Some(session) => Some(
                self.correlations
                    .create(session, agent.as_uuid())
                    .await
                    .map_err(|error| {
                        tracing::error!(?error, "could not persist code-mode correlation");
                        CodeModeError::Unavailable
                    })?,
            ),
            None => None,
        };
        // Same lifetime as session runs: the 30-second deadline plus clock margin.
        let token = self
            .signer
            .mint_for_agent(
                user,
                60,
                Some(agent.as_uuid()),
                caller.via().map(str::to_owned),
                None,
                correlation,
            )
            .await
            .map_err(|error| {
                tracing::error!(?error, "could not mint execution credential");
                CodeModeError::Unavailable
            })?;
        Ok(RunEnvironment {
            token,
            trace_headers: trace_headers(),
            endpoints: self.endpoints.clone(),
            session_id: None,
            execution_id: None,
            unattended: None,
        })
    }
}

/// The current trace context, for the SDK to forward on authenticated requests.
pub(crate) fn trace_headers() -> BTreeMap<String, String> {
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

pub fn sdk_endpoints() -> anyhow::Result<SdkEndpoints> {
    use agent_harness_service_url::AgentHarnessServiceUrl;
    use ai_editing_worker_url::AiEditingWorkerUrl;
    use app_service_url::AppServiceUrl;
    use auth_service_url::AuthServiceUrl;
    use calendar_service_url::CalendarServiceUrl;
    use connection_gateway_url::ConnectionGatewayUrl;
    use contacts_service_url::ContactsServiceUrl;
    use document_cognition_service_url::DocumentCognitionServiceUrl;
    use document_storage_service_url::DocumentStorageServiceUrl;
    use email_service_url::EmailServiceUrl;
    use notification_service_url::NotificationServiceUrl;
    use scheduled_action_service_url::ScheduledActionServiceUrl;
    use static_file_public_url::StaticFilePublicUrl;
    use static_file_service_url::StaticFileServiceUrl;
    use unfurl_service_url::UnfurlServiceUrl;
    let storage = DocumentStorageServiceUrl::new()?.to_string();
    let hosts = [
        (
            "document-content",
            DocumentStorageServiceCloudfrontDistributionUrl::new()?.to_string(),
        ),
        ("static-content", StaticFilePublicUrl::new()?.to_string()),
        ("editing-worker", AiEditingWorkerUrl::new()?.to_string()),
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
    .collect();
    Ok(SdkEndpoints {
        hosts,
        web_app_url: AppServiceUrl::new()?.to_string(),
    })
}

pub mod connected_apps;
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
