//! The MCP server's adapter for the agent-led setup port that lives outside
//! the setup crate's reach: the person's onboarding and account.

#[cfg(test)]
mod test;

use std::sync::Arc;

use agent_setup::domain::ports::{AccountStatus, Result, SetupAccounts, SetupError};
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use onboarding::domain::service::OnboardingService;
use rootcause::compat::IntoRootcause;

use crate::public_mcp::agent_led::{AccountDirectory, AgentHandover};

/// [`SetupAccounts`] over the onboarding row and the agent handover.
pub struct HandoverSetupAccounts<O, A> {
    onboarding: Arc<O>,
    handover: AgentHandover<O, A>,
}

impl<O, A> HandoverSetupAccounts<O, A> {
    /// An adapter over the onboarding service and the handover built on it.
    pub fn new(onboarding: Arc<O>, handover: AgentHandover<O, A>) -> Self {
        Self {
            onboarding,
            handover,
        }
    }
}

#[async_trait]
impl<O, A> SetupAccounts for HandoverSetupAccounts<O, A>
where
    O: OnboardingService,
    A: AccountDirectory + Clone,
{
    async fn status(&self, user: &MacroUserIdStr<'static>) -> Result<AccountStatus> {
        let row =
            self.onboarding.row(user.clone()).await.map_err(|error| {
                SetupError::Internal(rootcause::Report::new(error).into_dynamic())
            })?;
        let agent_led = row.as_ref().is_some_and(|row| row.is_agent_led());
        let setup_done = row
            .as_ref()
            .is_some_and(|row| row.agent_setup_done_at.is_some());
        let onboarded_on_web = row.as_ref().is_some_and(|row| {
            row.status == onboarding::domain::models::OnboardingStatus::Completed && !agent_led
        });
        let new_account = !agent_led
            && !onboarded_on_web
            && self
                .handover
                .is_new_account(user, chrono::Utc::now())
                .await
                .into_rootcause()?;
        let has_team = self
            .handover
            .accounts()
            .has_team(user)
            .await
            .into_rootcause()?;
        Ok(AccountStatus {
            agent_led,
            onboarded_on_web,
            new_account,
            setup_done,
            has_team,
        })
    }

    async fn hand_to_agent(&self, user: &MacroUserIdStr<'static>) -> Result<()> {
        self.handover.hand_over(user, None).await.into_rootcause()?;
        Ok(())
    }

    async fn finish(&self, user: &MacroUserIdStr<'static>) -> Result<()> {
        self.onboarding
            .finish_agent_setup(user.clone())
            .await
            .map_err(|error| SetupError::Internal(rootcause::Report::new(error).into_dynamic()))
    }
}
