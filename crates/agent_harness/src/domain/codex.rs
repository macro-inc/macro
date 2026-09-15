//! Per-owner Codex authorization and provider mapping for hosted conversations.
use super::ports::RepositoryDecision;
use agent_session::domain::{
    model::{AgentSessionId, ExternalSession},
    ports::{AgentSessionRepo, ExternalSessionRepo},
};
use codex_cloud_agents::domain::cloud::{
    CloudConversation, CloudEventStream, CloudId, CreatedTask, Launch, TaskSnapshot, TurnId,
};
use codex_cloud_agents::domain::runtime::{CloudRuntime, CloudTarget, RuntimeIdentity};
use codex_cloud_agents::domain::{Credentials, OAuth};
use codex_connection::domain::ConnectionService;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

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
    /// Owning session port for prior repository context and recording the selected repository.
    pub history: H,
    /// Shared metered model decision; its candidates are this owner's Codex repositories.
    pub decision: Arc<dyn RepositoryDecision>,
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
        prompt: &str,
        _: Option<&CloudTarget>,
    ) -> Result<CloudTarget, rootcause::Report> {
        let resolved = self.connection().await?;
        let environments = self.provider.environments(&resolved.credentials).await?;
        let (environment, branch) = if let Some(id) = resolved.environment_id {
            let environment = environments.iter().find(|environment| environment.id == id.as_str())
                .ok_or_else(||rootcause::report!("the configured Codex environment is unavailable; select an environment in Harness settings"))?;
            (environment, resolved.branch)
        } else {
            let identities: Vec<_> = environments
                .iter()
                .map(|environment| {
                    environment
                        .repositories
                        .first()
                        .map(|repository| repository_identity(&repository.clone_url))
                        .transpose()
                })
                .collect::<Result<_, _>>()?;
            let mut candidates: Vec<String> = identities.iter().flatten().cloned().collect();
            candidates.sort();
            candidates.dedup();
            if candidates.is_empty() {
                return Err(rootcause::report!(
                    "no Codex repository metadata is available for automatic selection; select an environment in Harness settings"
                ));
            }
            let recent = self.history.recent_for_owner(&self.owner, std::num::NonZeroUsize::new(6).expect("nonzero")).await
                .map_err(|error|rootcause::report!("could not read repository context; select an environment in Harness settings: {error}"))?;
            let recent: Vec<_> = recent
                .into_iter()
                .filter(|session| session.id != self.session)
                .take(5)
                .collect();
            let selected = self.decision.choose(&self.owner,prompt,&candidates,&recent).await
                .map_err(|_|rootcause::report!("automatic Codex repository selection failed; select an environment in Harness settings and retry"))?
                .ok_or_else(||rootcause::report!("the prompt does not identify a Codex repository; select an environment in Harness settings and retry"))?;
            if !candidates.contains(&selected) {
                return Err(rootcause::report!(
                    "automatic selection returned an unavailable repository; select an environment in Harness settings"
                ));
            }
            let mut matching = environments
                .iter()
                .zip(&identities)
                .filter(|(_, identity)| identity.as_deref() == Some(selected.as_str()))
                .map(|(environment, _)| environment);
            let environment = matching.next().ok_or_else(|| {
                rootcause::report!("the selected repository has no available Codex environment")
            })?;
            if matching.next().is_some() {
                return Err(rootcause::report!(
                    "multiple Codex environments use this repository; select an environment in Harness settings and retry"
                ));
            }
            let repository = environment
                .repositories
                .first()
                .expect("matched primary repository");
            (environment, repository.default_branch.clone())
        };
        let target = CloudTarget {
            environment: CloudId::new(environment.id.clone())?,
            branch,
            repository_url: environment
                .repositories
                .first()
                .map(|repository| repository_identity(&repository.clone_url))
                .transpose()?,
        };
        target.validate()?;
        // Choosing may await a model; do not pin a result after disconnect/reconnect.
        self.credentials().await?;
        self.history
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
