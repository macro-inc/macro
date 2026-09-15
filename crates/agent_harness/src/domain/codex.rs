//! Per-owner Codex authorization and provider mapping for hosted conversations.
use agent_session::domain::{
    model::{AgentSessionId, ExternalSession},
    ports::ExternalSessionRepo,
};
use codex_cloud_agents::domain::cloud::{
    CloudConversation, CloudEventStream, CloudId, CreatedTask, Launch, TaskSnapshot, TurnId,
};
use codex_cloud_agents::domain::runtime::{CloudRuntime, RuntimeIdentity};
use codex_cloud_agents::domain::{Credentials, OAuth};
use codex_connection::domain::ConnectionService;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

/// Provider slug persisted with Codex external session mappings.
pub const CODEX_PROVIDER: &str = "codex-cloud";
/// A cloud client bound to the session owner's original connection generation.
pub struct CodexRuntime<P, S> {
    /// Shared transport, containing no owner credentials.
    pub provider: Arc<P>,
    /// Connection lifecycle service, consulted before every provider operation.
    pub connections: Arc<dyn ConnectionService>,
    /// Session owner whose authorization pays for cloud work.
    pub owner: MacroUserIdStr<'static>,
    /// Immutable original connection/account identity.
    pub binding: RuntimeIdentity,
    /// Macro session receiving the external task mapping.
    pub session: AgentSessionId,
    /// Owning session persistence port.
    pub sessions: S,
}
impl<P, S> CodexRuntime<P, S> {
    async fn credentials(&self) -> Result<Credentials, rootcause::Report> {
        let resolved = self.connections.resolve(self.owner.as_ref()).await?;
        if resolved.connection_id.to_string() != self.binding.connection_id
            || resolved.credentials.account_id != self.binding.account_id
        {
            return Err(rootcause::report!(
                "this session belongs to a previous Codex connection; start a new session after reconnecting"
            ));
        }
        Ok(resolved.credentials)
    }
}
impl<P: OAuth + CloudConversation, S: ExternalSessionRepo> CloudRuntime for CodexRuntime<P, S> {
    async fn identity(&self) -> Result<RuntimeIdentity, rootcause::Report> {
        self.credentials().await?;
        Ok(self.binding.clone())
    }
    async fn launch(&self, request: &Launch) -> Result<CreatedTask, rootcause::Report> {
        request.validate()?;
        let auth = self.credentials().await?;
        if !self
            .provider
            .environments(&auth)
            .await?
            .iter()
            .any(|env| env.id == request.environment.as_str())
        {
            return Err(rootcause::report!(
                "the selected Codex environment is no longer available to this account"
            ));
        }
        let receipt = self.provider.create(&auth, request).await?;
        self.sessions
            .upsert(
                self.session,
                ExternalSession {
                    provider: CODEX_PROVIDER.into(),
                    external_id: receipt.task_id.as_str().into(),
                    external_name: None,
                    external_url: Some(receipt.url.clone()),
                    last_run_id: receipt
                        .assistant_turn_id
                        .as_ref()
                        .map(|turn| turn.as_str().into()),
                },
            )
            .await
            .map_err(|e| rootcause::report!("could not record Codex task mapping: {e}"))?;
        Ok(receipt)
    }
    async fn snapshot(&self, task: &CloudId) -> Result<TaskSnapshot, rootcause::Report> {
        self.provider
            .snapshot(&self.credentials().await?, task)
            .await
    }
    async fn follow_up(
        &self,
        task: &CloudId,
        turn: &TurnId,
        prompt: &str,
    ) -> Result<CreatedTask, rootcause::Report> {
        self.provider
            .follow_up(&self.credentials().await?, task, turn, prompt)
            .await
    }
    async fn cancel(&self, task: &CloudId) -> Result<(), rootcause::Report> {
        self.provider.cancel(&self.credentials().await?, task).await
    }
    async fn turn(&self, task: &CloudId, turn: &TurnId) -> Result<TaskSnapshot, rootcause::Report> {
        self.provider
            .turn(&self.credentials().await?, task, turn)
            .await
    }
    async fn stream(
        &self,
        task: &CloudId,
        turn: &TurnId,
    ) -> Result<CloudEventStream, rootcause::Report> {
        self.provider
            .stream(&self.credentials().await?, task, turn)
            .await
    }
}

#[cfg(test)]
mod test;
