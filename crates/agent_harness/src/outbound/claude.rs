//! Claude implementations of the shared container and model-discovery ports.
use crate::domain::{
    claude::ClaudeSessions,
    error::{HarnessError, Result},
    model::SpawnContainer,
    model_load::{ClaudeModelProbe, ModelProbeError, RawModelProbe},
    ports::{ContainerManager, SandboxEgressProvisioner},
    sandbox::SandboxResizeEffect,
};
use agent_runtime_protocol::domain::connection::ServerChannel;
use agent_session::domain::{
    connection::RuntimeAttachment,
    model::{AgentSessionId, SandboxSize},
    ports::{AgentSessionRepo, ExternalSessionRepo},
};
use claude_cloud_agents::domain::{model::Error, ports::CloudProvider, service::Session};
use std::sync::Arc;

/// Adapts the Claude lifecycle service to the same provisioning port as other providers.
pub struct ClaudeContainerManager<P, Repo, External, Egress, Attach> {
    sessions: ClaudeSessions<P, Repo, External>,
    egress: Egress,
    attach: Attach,
    tokens: tokio::sync::RwLock<std::collections::HashMap<AgentSessionId, String>>,
}

impl<P, Repo, External, Egress, Attach> ClaudeContainerManager<P, Repo, External, Egress, Attach> {
    /// Supply the ACP adapter from the composition root, keeping adapter imports local.
    pub fn new(
        sessions: ClaudeSessions<P, Repo, External>,
        egress: Egress,
        attach: Attach,
    ) -> Self {
        Self {
            sessions,
            egress,
            attach,
            tokens: Default::default(),
        }
    }
}

impl<P, Repo, External, Egress, Attach> ContainerManager
    for ClaudeContainerManager<P, Repo, External, Egress, Attach>
where
    P: CloudProvider,
    Repo: AgentSessionRepo,
    External: ExternalSessionRepo,
    Egress: SandboxEgressProvisioner,
    Attach: Fn(Arc<Session<P::Client>>) -> ServerChannel + Send + Sync + 'static,
{
    type Transport = ServerChannel;

    async fn spawn(&self, command: SpawnContainer) -> Result<RuntimeAttachment<ServerChannel>> {
        let session = self.sessions.attach(command.session_id).await?;
        self.tokens
            .write()
            .await
            .insert(command.session_id, command.egress.session_token);
        Ok(RuntimeAttachment::solo((self.attach)(session)))
    }

    async fn resume(&self, id: AgentSessionId) -> Result<RuntimeAttachment<ServerChannel>> {
        let session = self.sessions.attach(id).await?;
        let token = self.sessions.refresh_egress(id, &self.egress).await?;
        self.tokens.write().await.insert(id, token);
        Ok(RuntimeAttachment::solo((self.attach)(session)))
    }

    async fn session_token(&self, id: AgentSessionId) -> Result<Option<String>> {
        Ok(self.tokens.read().await.get(&id).cloned())
    }

    async fn teardown(&self, id: AgentSessionId) -> Result<()> {
        self.sessions.archive(id).await?;
        self.tokens.write().await.remove(&id);
        Ok(())
    }

    fn resize_effect(&self, _: SandboxSize, _: SandboxSize) -> SandboxResizeEffect {
        SandboxResizeEffect::Unsupported
    }

    async fn resize(&self, _: AgentSessionId, _: SandboxSize) -> Result<()> {
        Err(HarnessError::Container(
            "Claude manages its own cloud compute".into(),
        ))
    }
}

/// Read-only discovery through the same account-bound provider as execution.
pub struct ClaudeModels<P>(pub Arc<P>);

impl<P: CloudProvider> ClaudeModelProbe for ClaudeModels<P> {
    fn probe<'a>(
        &'a self,
        caller: &'a macro_user_id::user_id::MacroUserIdStr<'static>,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<Output = std::result::Result<RawModelProbe, ModelProbeError>>
                + Send
                + 'a,
        >,
    > {
        Box::pin(async move {
            let client = match self.0.connect(caller.as_ref()).await {
                Ok(client) => client,
                Err(Error::NotConnected) => return Ok(RawModelProbe::Unsupported),
                Err(error) => return Err(ModelProbeError::Failed(error.to_string())),
            };
            let catalog = claude_cloud_agents::domain::models::discover(&client)
                .await
                .map_err(|error| ModelProbeError::Failed(error.to_string()))?;
            let options: Vec<_> = catalog.options().iter().map(|option| serde_json::json!({
                "value": option.model.id(), "name": option.name, "description": option.description
            })).collect();
            let options = serde_json::from_value(serde_json::json!([{
                "id":"model", "name":"Model", "category":"model", "type":"select",
                "currentValue":"claude-default", "options": options
            }]))
            .map_err(|_| ModelProbeError::Failed("Invalid Claude model configuration".into()))?;
            Ok(RawModelProbe::Options(options))
        })
    }
}
