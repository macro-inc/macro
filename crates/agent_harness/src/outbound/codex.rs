//! Hosts per-owner Codex ACP conversations with PostgreSQL ownership fencing.
use super::acp_pipe::PipeTransport;
use crate::domain::{
    codex::{CODEX_PROVIDER, CodexRuntime},
    error::{HarnessError, Result},
    model::SpawnContainer,
    ports::ContainerManager,
    sandbox::SandboxResizeEffect,
};
use agent_session::domain::{
    connection::{AttachmentActivation, RuntimeAttachment},
    model::{AgentSessionId, SandboxSize},
    ports::{AgentSessionRepo, ExternalSessionRepo},
};
use codex_cloud_agents::domain::{
    OAuth,
    acp_session::{SessionService, SessionStore},
    cloud::CloudConversation,
    runtime::RuntimeIdentity,
};
use codex_connection::domain::ConnectionService;
use std::sync::Arc;

/// Provisions an ACP attachment; cloud execution begins only with a prompt.
pub struct CodexContainerManager<P, S, J> {
    provider: Arc<P>,
    connections: Option<Arc<dyn ConnectionService>>,
    sessions: S,
    pull_requests: Option<Arc<dyn agent_session::domain::pull_request::SessionPullRequests>>,
    journal: Arc<dyn Fn(AgentSessionId) -> (J, AttachmentActivation) + Send + Sync>,
}
impl<P, S: Clone, J> Clone for CodexContainerManager<P, S, J> {
    fn clone(&self) -> Self {
        Self {
            provider: self.provider.clone(),
            connections: self.connections.clone(),
            sessions: self.sessions.clone(),
            pull_requests: self.pull_requests.clone(),
            journal: self.journal.clone(),
        }
    }
}
impl<
    P: OAuth + CloudConversation + 'static,
    S: AgentSessionRepo + ExternalSessionRepo + Clone + 'static,
    J: SessionStore + 'static,
> CodexContainerManager<P, S, J>
{
    /// Compose owner connection and cloud ports with the process's durable session claim.
    pub fn new(
        provider: Arc<P>,
        connections: Option<Arc<dyn ConnectionService>>,
        sessions: S,
        journal: Arc<dyn Fn(AgentSessionId) -> (J, AttachmentActivation) + Send + Sync>,
    ) -> Self {
        Self {
            provider,
            connections,
            sessions,
            pull_requests: None,
            journal,
        }
    }
    /// Publish verified Codex PRs through the same session operation as other runtimes.
    pub fn with_pull_requests(
        mut self,
        service: Arc<dyn agent_session::domain::pull_request::SessionPullRequests>,
    ) -> Self {
        self.pull_requests = Some(service);
        self
    }
    async fn attach(&self, id: AgentSessionId) -> Result<RuntimeAttachment<PipeTransport>> {
        let row = AgentSessionRepo::get(&self.sessions, id).await?;
        let connections = self.connections.clone().ok_or_else(|| {
            HarnessError::Container(
                "Codex connection encryption is not configured on this deployment".into(),
            )
        })?;
        let resolved = connections
            .resolve(row.owner_id.as_ref())
            .await
            .map_err(|e| HarnessError::Container(e.to_string()))?;
        let claim = Arc::new(std::sync::OnceLock::new());
        let runtime = Arc::new(CodexRuntime {
            provider: self.provider.clone(),
            connections,
            owner: row.owner_id.clone(),
            binding: RuntimeIdentity {
                connection_id: resolved.connection_id.to_string(),
                account_id: resolved.credentials.account_id.clone(),
            },
            session: id,
            sessions: self.sessions.clone(),
            session_repository: self.sessions.clone(),
            pull_requests: self.pull_requests.clone(),
            claim: claim.clone(),
        });
        let (journal, activate) = (self.journal)(id);
        let activate: AttachmentActivation = Box::new(move |ownership| {
            activate(ownership)?;
            claim.set(ownership).map_err(|_| {
                agent_runtime_protocol::domain::ports::TransportError::Client(
                    "Codex attachment already activated".into(),
                )
                .into()
            })
        });
        let service = Arc::new(
            SessionService::new(runtime, journal, None).with_session_id(id.as_uuid().to_string()),
        );
        let (ours, theirs) = tokio::io::duplex(64 * 1024);
        let (reader, writer) = tokio::io::split(theirs);
        let closed = tokio_util::sync::CancellationToken::new();
        let on_close = closed.clone();
        let (reload_tx, reload_rx) = tokio::sync::mpsc::unbounded_channel();
        tokio::spawn(async move {
            if let Err(error) =
                codex_cloud_agents::inbound::acp::serve(service, reader, writer, Some(reload_tx))
                    .await
            {
                tracing::warn!(%id,error=%error,"Codex ACP transport closed");
            }
            on_close.cancel();
        });
        Ok(RuntimeAttachment::solo(PipeTransport::connect_recoverable(
            ours,
            || {},
            closed.clone(),
            Some(reload_rx),
        ))
        .with_closed(closed)
        .on_activate(activate))
    }
}
impl<
    P: OAuth + CloudConversation + 'static,
    S: AgentSessionRepo + ExternalSessionRepo + Clone + 'static,
    J: SessionStore + 'static,
> ContainerManager for CodexContainerManager<P, S, J>
{
    type Transport = PipeTransport;
    async fn spawn(&self, command: SpawnContainer) -> Result<RuntimeAttachment<PipeTransport>> {
        self.attach(command.session_id).await
    }
    async fn resume(&self, session: AgentSessionId) -> Result<RuntimeAttachment<PipeTransport>> {
        self.attach(session).await
    }
    async fn session_token(&self, _session: AgentSessionId) -> Result<Option<String>> {
        Ok(None)
    }
    async fn teardown(&self, session: AgentSessionId) -> Result<()> {
        let Some(external) = ExternalSessionRepo::get(&self.sessions, session).await? else {
            return Ok(());
        };
        if external.provider != CODEX_PROVIDER {
            return Err(HarnessError::Container(
                "Codex session has a foreign provider mapping".into(),
            ));
        }
        // Teardown removes only Macro's mapping. Remote work is cancelled through
        // the explicit authorized session/cancel operation; deletion does not imply stop.
        ExternalSessionRepo::delete(&self.sessions, session).await?;
        Ok(())
    }
    fn resize_effect(&self, _from: SandboxSize, _to: SandboxSize) -> SandboxResizeEffect {
        SandboxResizeEffect::Unsupported
    }
    async fn resize(&self, _session: AgentSessionId, _size: SandboxSize) -> Result<()> {
        Err(HarnessError::Container(
            "Codex cloud compute cannot be resized from Macro".into(),
        ))
    }
}
