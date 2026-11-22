//! The onboarding orchestrator: assembles the aggregate and records when the
//! flow finishes.

use super::models::{ConnectedServer, DismissedPrompts, OnboardingRow, OnboardingState, PromptId};
use super::ports::{OnboardingError, OnboardingRepo, Result};
use connectors::domain::models::Status;
use connectors::domain::service::ConnectionManagementService;
use generic_email_domains::is_generic_email_domain;
use macro_user_id::email::ReadEmailParts;
use macro_user_id::user_id::MacroUserIdStr;
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

/// Concrete orchestrator wiring the repo and the user's connections
/// together.
pub struct OnboardingServiceImpl<R, S> {
    repo: R,
    connectors: Arc<S>,
}

impl<R, S> OnboardingServiceImpl<R, S> {
    /// Build the orchestrator over the connectors service.
    pub fn new(repo: R, connectors: Arc<S>) -> Self {
        Self { repo, connectors }
    }
}

impl<R, S> OnboardingServiceImpl<R, S>
where
    R: OnboardingRepo,
    S: ConnectionManagementService,
{
    /// The apps and servers the user has connected and can use, as the
    /// connectors services decide it.
    async fn connected_servers(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<ConnectedServer>> {
        let connectors = self
            .connectors
            .list(user)
            .await
            .map_err(|e| OnboardingError::Other(anyhow::anyhow!("connectors: {e}")))?;
        Ok(connectors
            .into_iter()
            .filter(|connector| connector.status() == Status::Connected)
            .map(|connector| ConnectedServer {
                name: connector.name().to_owned(),
                url: connector.key().to_string(),
                authenticated: true,
            })
            .collect())
    }
}

impl<R, S> OnboardingService for OnboardingServiceImpl<R, S>
where
    R: OnboardingRepo,
    S: ConnectionManagementService,
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
