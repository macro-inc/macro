//! The MCP server's adapters for the agent-led setup ports that live outside
//! the setup crate's reach: the person's inboxes and their onboarding.

#[cfg(test)]
mod test;

use std::sync::Arc;

use agent_setup::domain::ports::{AccountStatus, Result, SetupAccounts, SetupError, SetupInbox};
use async_trait::async_trait;
use email::domain::ports::EmailService;
use macro_user_id::user_id::MacroUserIdStr;
use onboarding::domain::service::OnboardingService;
use rootcause::compat::IntoRootcause;

use crate::agent_led::{AccountDirectory, AgentHandover, Handover};

/// [`SetupInbox`] over the email service: the person's own inboxes.
pub struct EmailSetupInbox<T> {
    service: Arc<T>,
}

impl<T> EmailSetupInbox<T> {
    /// An adapter over the email service.
    pub fn new(service: Arc<T>) -> Self {
        Self { service }
    }
}

#[async_trait]
impl<T: EmailService> SetupInbox for EmailSetupInbox<T> {
    async fn addresses(&self, user: &MacroUserIdStr<'static>) -> Result<Vec<String>> {
        let links = self
            .service
            .get_inboxes_for_macro_id(user.clone())
            .await
            .map_err(|error| {
                SetupError::Internal(rootcause::report!("listing inboxes: {error:?}"))
            })?;
        Ok(links
            .into_iter()
            .filter(|link| link.macro_id.to_string() == user.as_ref())
            .map(|link| link.email_address.0.as_ref().to_owned())
            .collect())
    }
}

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
        Ok(AccountStatus {
            agent_led,
            onboarded_on_web,
            new_account,
        })
    }

    async fn hand_to_agent(&self, user: &MacroUserIdStr<'static>) -> Result<AccountStatus> {
        let outcome = self.handover.hand_over(user, None).await.into_rootcause()?;
        Ok(match outcome {
            Handover::AgentLed => AccountStatus {
                agent_led: true,
                onboarded_on_web: false,
                new_account: false,
            },
            Handover::WebOnboarded => AccountStatus {
                agent_led: false,
                onboarded_on_web: true,
                new_account: false,
            },
            Handover::Existing => self.status(user).await?,
        })
    }
}
