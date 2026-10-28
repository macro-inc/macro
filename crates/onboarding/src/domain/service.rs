//! The onboarding orchestrator: assembles the aggregate and records when the
//! flow finishes.

use super::models::{ConnectedServer, DismissedPrompts, OnboardingRow, OnboardingState, PromptId};
use super::ports::{OnboardingError, OnboardingRepo, Result};
use generic_email_domains::is_generic_email_domain;
use macro_user_id::email::ReadEmailParts;
use macro_user_id::user_id::MacroUserIdStr;
use mcp_client::domain::ports::McpServerStore;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// The account email's domain when it can back a domain team (not a
/// generic consumer provider), `None` otherwise. The same judgment the
/// teams service applies to domain auto-join and claiming.
fn suggested_team_domain(user: &MacroUserIdStr<'_>) -> Option<String> {
    let email = user.email_part().lowercase();
    let domain = email.domain_part();
    (!is_generic_email_domain(domain)).then(|| domain.to_owned())
}

/// The API the onboarding router (and host-service hooks) talk to.
pub trait OnboardingService: Send + Sync + 'static {
    /// The full aggregate for the user.
    fn get_state(
        &self,
        user: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<OnboardingState>> + Send;

    /// Finish the flow (`skipped` records how).
    fn complete(
        &self,
        user: MacroUserIdStr<'static>,
        skipped: bool,
    ) -> impl Future<Output = Result<OnboardingRow>> + Send;

    /// The sidebar prompts the user dismissed, so a dismissal holds on
    /// every device. Never enters the user into the onboarding flow.
    fn dismissed_prompts(
        &self,
        user: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<DismissedPrompts>> + Send;

    /// Dismiss one sidebar prompt for good.
    fn dismiss_prompt(
        &self,
        user: MacroUserIdStr<'static>,
        prompt: PromptId,
    ) -> impl Future<Output = Result<()>> + Send;
}

/// Concrete orchestrator wiring the repo and the user's MCP servers together.
pub struct OnboardingServiceImpl<R, S> {
    repo: R,
    mcp_store: Arc<S>,
}

impl<R, S> OnboardingServiceImpl<R, S> {
    /// Build the orchestrator.
    pub fn new(repo: R, mcp_store: Arc<S>) -> Self {
        Self { repo, mcp_store }
    }
}

impl<R, S> OnboardingServiceImpl<R, S>
where
    R: OnboardingRepo,
    S: McpServerStore,
{
    async fn connected_servers(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<ConnectedServer>> {
        let servers = self
            .mcp_store
            .list(user)
            .await
            .map_err(|e| OnboardingError::Other(anyhow::anyhow!("mcp store: {e:?}")))?;
        Ok(servers
            .into_iter()
            .map(|record| ConnectedServer {
                name: record.server_name,
                url: record.url,
                authenticated: record.credentials.is_some(),
            })
            .collect())
    }
}

impl<R, S> OnboardingService for OnboardingServiceImpl<R, S>
where
    R: OnboardingRepo,
    S: McpServerStore,
{
    #[tracing::instrument(skip(self, user), err)]
    async fn get_state(&self, user: MacroUserIdStr<'static>) -> Result<OnboardingState> {
        let row = self.repo.ensure_row(&user).await?;
        let connected_servers = self.connected_servers(&user).await?;
        Ok(OnboardingState {
            row,
            connected_servers,
            suggested_team_domain: suggested_team_domain(&user),
        })
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn complete(
        &self,
        user: MacroUserIdStr<'static>,
        skipped: bool,
    ) -> Result<OnboardingRow> {
        self.repo.complete(&user, skipped).await
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn dismissed_prompts(&self, user: MacroUserIdStr<'static>) -> Result<DismissedPrompts> {
        Ok(DismissedPrompts {
            dismissed: self.repo.dismissed_prompts(&user).await?,
        })
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn dismiss_prompt(&self, user: MacroUserIdStr<'static>, prompt: PromptId) -> Result<()> {
        self.repo.dismiss_prompt(&user, &prompt).await
    }
}
