//! [`AgentMailboxes`] over email_service's internal agent mailbox routes.

use email_service_client::agent_mailboxes::{
    AgentMailboxErrorCode, AgentMailboxResponse, AgentMailboxesClient, AgentMailboxesError,
    MailboxState, ProvisionAgentMailboxRequest, ProvisioningFailure, VendorMode,
};
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::inbox::{
    AgentInboxFailure, AgentInboxState, AgentMailboxes, MailboxError, MailboxView, ProvisionMailbox,
};

#[cfg(test)]
mod test;

/// Agent mailboxes in email_service.
#[derive(Clone)]
pub struct EmailServiceMailboxes {
    client: AgentMailboxesClient,
}

impl EmailServiceMailboxes {
    /// Use email_service through `client`.
    pub fn new(client: AgentMailboxesClient) -> Self {
        Self { client }
    }
}

fn state(state: MailboxState) -> AgentInboxState {
    match state {
        MailboxState::Provisioning => AgentInboxState::Provisioning,
        MailboxState::Active => AgentInboxState::Active,
        MailboxState::Failed => AgentInboxState::Failed,
        MailboxState::Paused => AgentInboxState::Paused,
        MailboxState::Releasing => AgentInboxState::Releasing,
        MailboxState::Released => AgentInboxState::Released,
    }
}

fn failure(failure: ProvisioningFailure) -> AgentInboxFailure {
    match failure {
        ProvisioningFailure::NotConfigured => AgentInboxFailure::NotConfigured,
        ProvisioningFailure::AddressTaken => AgentInboxFailure::AddressTaken,
        ProvisioningFailure::QuotaExceeded => AgentInboxFailure::QuotaExceeded,
        ProvisioningFailure::Rejected => AgentInboxFailure::Rejected,
        ProvisioningFailure::Unavailable => AgentInboxFailure::Unavailable,
    }
}

fn view(response: AgentMailboxResponse) -> MailboxView {
    let mailbox = response.mailbox;
    MailboxView {
        mailbox_id: mailbox.id.0,
        address: mailbox.address,
        state: state(mailbox.state),
        last_error: mailbox.last_error.map(failure),
        fake_provider: match mailbox.vendor_mode {
            VendorMode::Live => false,
            VendorMode::Fake => true,
        },
    }
}

fn error(error: AgentMailboxesError) -> MailboxError {
    match error.code() {
        Some(AgentMailboxErrorCode::NotConfigured) => MailboxError::NotConfigured,
        Some(AgentMailboxErrorCode::ProviderRejected) => MailboxError::Rejected,
        _ => MailboxError::Unavailable(rootcause::Report::new(error).into_dynamic()),
    }
}

fn is_missing(error: &AgentMailboxesError) -> bool {
    error.code() == Some(AgentMailboxErrorCode::NotFound)
}

impl AgentMailboxes for EmailServiceMailboxes {
    async fn provision(&self, request: &ProvisionMailbox) -> Result<MailboxView, MailboxError> {
        let answer = self
            .client
            .provision(&ProvisionAgentMailboxRequest {
                request_id: request.request_id,
                agent_user_id: request.agent.as_ref().to_owned(),
                display_name: Some(request.display_name.clone()),
                requested_local_part: Some(request.local_part.clone()),
            })
            .await;
        match answer {
            Ok(response) => Ok(view(response)),
            // The agent's mailbox came from an earlier request: answer with it.
            Err(refused) if refused.code() == Some(AgentMailboxErrorCode::AlreadyProvisioned) => {
                self.status(&request.agent)
                    .await?
                    .ok_or_else(|| error(refused))
            }
            Err(refused) => Err(error(refused)),
        }
    }

    async fn status(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<Option<MailboxView>, MailboxError> {
        match self.client.status(agent.as_ref()).await {
            Ok(response) => Ok(Some(view(response))),
            Err(refused) if is_missing(&refused) => Ok(None),
            Err(refused) => Err(error(refused)),
        }
    }

    async fn pause(&self, agent: &MacroUserIdStr<'_>) -> Result<(), MailboxError> {
        match self.client.pause(agent.as_ref()).await {
            Ok(_) => Ok(()),
            Err(refused) if is_missing(&refused) => Ok(()),
            Err(refused) => Err(error(refused)),
        }
    }

    async fn release(&self, agent: &MacroUserIdStr<'_>) -> Result<(), MailboxError> {
        match self.client.release(agent.as_ref()).await {
            Ok(()) => Ok(()),
            Err(refused) if is_missing(&refused) => Ok(()),
            // Left releasing: email_service's sweep finishes it.
            Err(refused) if refused.code() == Some(AgentMailboxErrorCode::ProviderUnavailable) => {
                Ok(())
            }
            Err(refused) => Err(error(refused)),
        }
    }
}
