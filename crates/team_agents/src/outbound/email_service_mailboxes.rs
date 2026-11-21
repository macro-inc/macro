//! [`AgentMailboxes`] over email_service's internal agent mailbox routes.

use email_service_client::agent_mailboxes::{
    AgentMailboxErrorCode, AgentMailboxResponse, AgentMailboxesClient, AgentMailboxesError,
    MailboxState, ProvisionAgentMailboxRequest, ProvisioningFailure, VendorMode,
};
use std::future::Future;
use std::time::Duration;

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::inbox::{
    AgentInboxFailure, AgentInboxState, AgentMailboxes, MailboxError, MailboxView,
    ProvisionMailbox, ReleaseOutcome,
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

/// How long one email_service call may take: the invite, the agents list
/// and removal wait on it.
const CALL_TIMEOUT: Duration = Duration::from_secs(10);

/// An email_service failure, without the request URL: the URL names the
/// agent, whose id is an email.
#[derive(Debug, thiserror::Error)]
enum EmailServiceFailure {
    /// The call didn't finish in time.
    #[error("email_service didn't answer within {CALL_TIMEOUT:?}")]
    TimedOut,
    /// The request didn't complete.
    #[error("email_service request failed: {0}")]
    Transport(String),
    /// email_service answered with an error.
    #[error("email_service answered {status}: {code:?}")]
    Answered {
        /// The HTTP status.
        status: u16,
        /// Its reason, if it gave one.
        code: Option<AgentMailboxErrorCode>,
    },
}

fn unavailable(failure: EmailServiceFailure) -> MailboxError {
    MailboxError::Unavailable(rootcause::Report::new(failure).into_dynamic())
}

fn error(error: AgentMailboxesError) -> MailboxError {
    let code = error.code();
    match code {
        Some(AgentMailboxErrorCode::NotConfigured) => return MailboxError::NotConfigured,
        Some(AgentMailboxErrorCode::TeamLimit) => return MailboxError::TeamLimit,
        // Refusals a retry won't change.
        Some(
            AgentMailboxErrorCode::ProviderRejected
            | AgentMailboxErrorCode::NotAnAgent
            | AgentMailboxErrorCode::Invalid
            | AgentMailboxErrorCode::NotReady
            | AgentMailboxErrorCode::Paused
            | AgentMailboxErrorCode::AlreadyProvisioned
            | AgentMailboxErrorCode::NotFound
            | AgentMailboxErrorCode::ConfirmationRequired
            | AgentMailboxErrorCode::SendOutcomeUnknown
            | AgentMailboxErrorCode::SendLimit,
        ) => return MailboxError::Rejected,
        Some(
            AgentMailboxErrorCode::ProviderUnavailable
            | AgentMailboxErrorCode::Busy
            | AgentMailboxErrorCode::Internal,
        )
        | None => {}
    }
    unavailable(match error {
        AgentMailboxesError::Refused { status, .. } | AgentMailboxesError::Unexpected(status) => {
            EmailServiceFailure::Answered {
                status: status.as_u16(),
                code,
            }
        }
        AgentMailboxesError::Transport(transport) => {
            EmailServiceFailure::Transport(transport.without_url().to_string())
        }
    })
}

/// `call`, bounded by [`CALL_TIMEOUT`].
async fn bounded<Answer>(
    call: impl Future<Output = Result<Answer, AgentMailboxesError>>,
) -> Result<Result<Answer, AgentMailboxesError>, MailboxError> {
    tokio::time::timeout(CALL_TIMEOUT, call)
        .await
        .map_err(|_| unavailable(EmailServiceFailure::TimedOut))
}

fn is_missing(error: &AgentMailboxesError) -> bool {
    error.code() == Some(AgentMailboxErrorCode::NotFound)
}

impl AgentMailboxes for EmailServiceMailboxes {
    async fn provision(&self, request: &ProvisionMailbox) -> Result<MailboxView, MailboxError> {
        let answer = bounded(self.client.provision(&ProvisionAgentMailboxRequest {
            request_id: request.request_id,
            agent_user_id: request.agent.as_ref().to_owned(),
            display_name: Some(request.display_name.clone()),
            requested_local_part: Some(request.local_part.clone()),
        }))
        .await?;
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
        match bounded(self.client.status(agent.as_ref())).await? {
            Ok(response) => Ok(Some(view(response))),
            Err(refused) if is_missing(&refused) => Ok(None),
            Err(refused) => Err(error(refused)),
        }
    }

    async fn pause(&self, agent: &MacroUserIdStr<'_>) -> Result<(), MailboxError> {
        match bounded(self.client.pause(agent.as_ref())).await? {
            Ok(_) => Ok(()),
            Err(refused) if is_missing(&refused) => Ok(()),
            // Already paused, or being deleted: nothing reads or sends.
            Err(refused)
                if matches!(
                    refused.code(),
                    Some(AgentMailboxErrorCode::Paused | AgentMailboxErrorCode::NotReady)
                ) =>
            {
                Ok(())
            }
            Err(refused) => Err(error(refused)),
        }
    }

    async fn release(&self, agent: &MacroUserIdStr<'_>) -> Result<ReleaseOutcome, MailboxError> {
        match bounded(self.client.release(agent.as_ref())).await? {
            Ok(()) => Ok(ReleaseOutcome::Released),
            Err(refused) if is_missing(&refused) => Ok(ReleaseOutcome::Released),
            // Left releasing: email_service's sweep finishes it.
            Err(refused)
                if matches!(
                    refused.code(),
                    Some(AgentMailboxErrorCode::ProviderUnavailable | AgentMailboxErrorCode::Busy)
                ) =>
            {
                Ok(ReleaseOutcome::Releasing)
            }
            Err(refused) => Err(error(refused)),
        }
    }
}
