//! Per-owner Codex authorization and provider mapping for hosted conversations.
use crate::domain::{error::HarnessError, model::SessionBlocker};
use agent_session::domain::{
    model::{AgentSessionId, ExternalSession},
    ports::{AgentSessionRepo, ExternalSessionRepo},
};
use codex_cloud_agents::domain::cloud::{
    CloudConversation, CloudEventStream, CloudId, CreatedTask, Launch, TaskSnapshot, TurnId,
};
use codex_cloud_agents::domain::runtime::{CloudRuntime, CloudTarget, RuntimeIdentity};
use codex_cloud_agents::domain::{Credentials, OAuth};
use codex_connection::domain::{ConnectionError, ConnectionService};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

/// Resolve the owner's account and environment before provisioning a session.
pub(crate) async fn connection_preflight(
    connections: &dyn ConnectionService,
    owner: &MacroUserIdStr<'_>,
) -> crate::domain::error::Result<Option<SessionBlocker>> {
    match connections.resolve(owner.as_ref()).await {
        Ok(connection) if connection.environment_id.is_none() => {
            Ok(Some(SessionBlocker::CodexEnvironmentNotConfigured))
        }
        Ok(_) => Ok(None),
        Err(ConnectionError::NotConnected) => Ok(Some(SessionBlocker::CodexNotConnected)),
        Err(error) => Err(HarnessError::Container(error.to_string())),
    }
}

fn repository_identity(value: &str) -> Result<String, rootcause::Report> {
    let parsed = url::Url::parse(value).map_err(|_| {
        rootcause::report!(
            "invalid Codex repository metadata; select an environment in Harness settings"
        )
    })?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(rootcause::report!(
            "invalid Codex repository metadata; select an environment in Harness settings"
        ));
    }
    let path = parsed.path().trim_end_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    if parsed.host_str() == Some("github.com") {
        Ok(format!("https://github.com{}", path.to_ascii_lowercase()))
    } else {
        let mut canonical = parsed.clone();
        canonical.set_path(path);
        Ok(canonical.to_string())
    }
}

/// Provider slug persisted with Codex external session mappings.
pub const CODEX_PROVIDER: &str = "codex-cloud";
/// A cloud client bound to the session owner's original connection generation.
pub struct CodexRuntime<P, S, H = S> {
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
    /// Owning session port for recording the configured repository.
    pub session_repository: H,
    /// Shared owner-authorized session PR publication service.
    pub pull_requests: Option<Arc<dyn agent_session::domain::pull_request::SessionPullRequests>>,
    /// Immutable ownership claim activated before this attachment can publish metadata.
    pub claim: Arc<std::sync::OnceLock<agent_session::domain::model::SessionClaim>>,
}
impl<P, S, H> CodexRuntime<P, S, H> {
    async fn connection(
        &self,
    ) -> Result<codex_connection::domain::ResolvedConnection, rootcause::Report> {
        let resolved = self.connections.resolve(self.owner.as_ref()).await?;
        if resolved.connection_id.to_string() != self.binding.connection_id
            || resolved.credentials.account_id != self.binding.account_id
        {
            return Err(rootcause::report!(
                "this session belongs to a previous Codex connection; start a new session after reconnecting"
            ));
        }
        Ok(resolved)
    }
    async fn credentials(&self) -> Result<Credentials, rootcause::Report> {
        Ok(self.connection().await?.credentials)
    }
}
impl<P: OAuth + CloudConversation, S: ExternalSessionRepo, H: AgentSessionRepo> CloudRuntime
    for CodexRuntime<P, S, H>
{
    async fn identity(&self) -> Result<RuntimeIdentity, rootcause::Report> {
        self.credentials().await?;
        Ok(self.binding.clone())
    }
    async fn resolve_target(
        &self,
        _: &str,
        _: Option<&CloudTarget>,
    ) -> Result<CloudTarget, rootcause::Report> {
        let resolved = self.connection().await?;
        let id = resolved.environment_id.ok_or_else(|| {
            rootcause::report!(
                "select and save a Codex environment in Harness settings before sending a prompt"
            )
        })?;
        let environments = self.provider.environments(&resolved.credentials).await?;
        let environment = environments.iter().find(|environment| environment.id == id.as_str())
            .ok_or_else(||rootcause::report!("the configured Codex environment is unavailable; select and save an environment in Harness settings"))?;
        let target = CloudTarget {
            environment: CloudId::new(environment.id.clone())?,
            branch: "main".into(),
            repository_url: environment
                .repositories
                .first()
                .map(|repository| repository_identity(&repository.clone_url))
                .transpose()?,
        };
        target.validate()?;
        // Do not pin a target after the owner disconnects or reconnects.
        self.credentials().await?;
        self.session_repository
            .set_repo_url(self.session, target.repository_url.clone())
            .await
            .map_err(|error| {
                rootcause::report!("could not record the selected Codex repository: {error}")
            })?;
        Ok(target)
    }
    async fn report_pull_request(&self, url: &str) -> Result<(), rootcause::Report> {
        self.credentials().await?;
        if let Some(service) = &self.pull_requests {
            service
                .set_pull_request(
                    self.session,
                    &self.owner,
                    url,
                    Some(
                        *self.claim.get().ok_or_else(|| {
                            rootcause::report!("Codex attachment is not activated")
                        })?,
                    ),
                )
                .await
                .map_err(|error| {
                    rootcause::report!("could not publish Codex pull request: {error}")
                })?;
        }
        Ok(())
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
