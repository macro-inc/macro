//! Composition of code execution credentials with the harness's owner approval gate.
use agent_code_mode::domain::{CodeModeError, ExecutionCredentials, ExecutionIdentity};
use agent_egress::outbound::macro_mcp::MacroApiTokenSigner;
use agent_inmem::domain::tool_gate::{NativeToolGate, NativeToolVerdict};
use async_trait::async_trait;
use code_execution::domain::RunEnvironment;
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
        approve_run(self.gate.as_ref(), identity, source, &cancel).await?;
        // No refresh credential. Covers the 30-second queue/run deadline plus
        // clock margin; a normal user token expires rather than revoking on exit.
        let token = self
            .signer
            .mint_for(&identity.owner, 60)
            .await
            .map_err(|error| {
                tracing::error!(?error, "could not mint execution credential");
                CodeModeError::Unavailable
            })?;
        let mut trace_headers = axum::http::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut trace_headers);
        Ok(RunEnvironment {
            token,
            trace_headers: trace_headers
                .iter()
                .filter_map(|(name, value)| {
                    value
                        .to_str()
                        .ok()
                        .map(|value| (name.to_string(), value.to_owned()))
                })
                .collect(),
            hosts: self.hosts.clone(),
            session_id: Some(identity.session.as_uuid()),
            execution_id: Some(identity.execution.as_uuid()),
        })
    }
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
) -> Result<(), CodeModeError> {
    let args = serde_json::json!({"source": source});
    let verdict = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(CodeModeError::Forbidden),
        verdict = async { gate.check(identity.session, "ExecuteCode", &args).await } => verdict,
    };
    match verdict {
        NativeToolVerdict::Run => Ok(()),
        NativeToolVerdict::Refuse(message) => Err(CodeModeError::Invalid(message)),
    }
}
#[cfg(test)]
mod test;
