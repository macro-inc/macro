//! The agent mailbox lifecycle routes (`/internal/agent-mailboxes`), for the
//! teammate service: provision, read, pause, resume and release an agent's
//! mailbox. The agent's own mail routes are not here; agents call those with
//! their own credential.

#[cfg(test)]
mod test;

pub use agent_mailbox::domain::models::{
    AgentMailboxId, AgentMailboxView, MailboxProvider, MailboxState, ProvisioningFailure,
    VendorMode,
};
pub use agent_mailbox::wire::{
    AgentMailboxErrorBody, AgentMailboxErrorCode, AgentMailboxResponse,
    ProvisionAgentMailboxRequest,
};

use reqwest::StatusCode;

use crate::EmailServiceClient;

/// A lifecycle call that did not succeed.
#[derive(Debug, thiserror::Error)]
pub enum AgentMailboxesError {
    /// The service refused, with its reason.
    #[error("agent mailbox request refused ({status}): {}", body.message)]
    Refused {
        /// The HTTP status.
        status: StatusCode,
        /// The service's reason.
        body: AgentMailboxErrorBody,
    },
    /// The service answered something this client cannot read.
    #[error("unexpected agent mailbox response ({0})")]
    Unexpected(StatusCode),
    /// The request did not complete; repeating it is safe.
    #[error("agent mailbox request failed")]
    Transport(#[from] reqwest::Error),
}

impl AgentMailboxesError {
    /// The service's reason, when it gave one.
    #[must_use]
    pub fn code(&self) -> Option<AgentMailboxErrorCode> {
        match self {
            Self::Refused { body, .. } => Some(body.code),
            Self::Unexpected(_) | Self::Transport(_) => None,
        }
    }
}

/// The lifecycle routes over [`EmailServiceClient`]'s internal credential.
#[derive(Clone)]
pub struct AgentMailboxesClient(EmailServiceClient);

impl EmailServiceClient {
    /// The agent mailbox lifecycle routes.
    #[must_use]
    pub fn agent_mailboxes(&self) -> AgentMailboxesClient {
        AgentMailboxesClient(self.clone())
    }
}

async fn read<Body: serde::de::DeserializeOwned>(
    response: reqwest::Response,
) -> Result<Body, AgentMailboxesError> {
    let status = response.status();
    if status.is_success() {
        return Ok(response.json().await?);
    }
    match response.json::<AgentMailboxErrorBody>().await {
        Ok(body) => Err(AgentMailboxesError::Refused { status, body }),
        Err(_) => Err(AgentMailboxesError::Unexpected(status)),
    }
}

impl AgentMailboxesClient {
    fn url(&self, path: &str) -> String {
        format!("{}/internal/agent-mailboxes{path}", self.0.url)
    }

    fn agent_url(&self, agent_user_id: &str, action: &str) -> String {
        let agent = urlencoding::encode(agent_user_id);
        self.url(&format!("/{agent}{action}"))
    }

    fn traced(request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        let mut trace_headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut trace_headers);
        request.headers(trace_headers)
    }

    /// Give an agent a mailbox. Repeating the same `request_id` is safe and
    /// returns the same mailbox; the answer may be active, failed, or still
    /// provisioning.
    #[tracing::instrument(skip_all, fields(agent_mailbox.request_id = %request.request_id), err)]
    pub async fn provision(
        &self,
        request: &ProvisionAgentMailboxRequest,
    ) -> Result<AgentMailboxResponse, AgentMailboxesError> {
        let response = Self::traced(self.0.client.post(self.url("")).json(request))
            .send()
            .await?;
        read(response).await
    }

    /// The agent's mailbox. A `not_found` refusal means it has none.
    #[tracing::instrument(skip_all, err)]
    pub async fn status(
        &self,
        agent_user_id: &str,
    ) -> Result<AgentMailboxResponse, AgentMailboxesError> {
        let response = Self::traced(self.0.client.get(self.agent_url(agent_user_id, "")))
            .send()
            .await?;
        read(response).await
    }

    /// Stop the agent reading or sending; the mailbox and its mail stay.
    #[tracing::instrument(skip_all, err)]
    pub async fn pause(
        &self,
        agent_user_id: &str,
    ) -> Result<AgentMailboxResponse, AgentMailboxesError> {
        let response = Self::traced(self.0.client.post(self.agent_url(agent_user_id, "/pause")))
            .send()
            .await?;
        read(response).await
    }

    /// Undo a pause.
    #[tracing::instrument(skip_all, err)]
    pub async fn resume(
        &self,
        agent_user_id: &str,
    ) -> Result<AgentMailboxResponse, AgentMailboxesError> {
        let response = Self::traced(self.0.client.post(self.agent_url(agent_user_id, "/resume")))
            .send()
            .await?;
        read(response).await
    }

    /// Delete the agent's mailbox and its mail at the provider. Safe to
    /// repeat; a `provider_unavailable` refusal leaves it releasing, and the
    /// service's sweep finishes it.
    #[tracing::instrument(skip_all, err)]
    pub async fn release(&self, agent_user_id: &str) -> Result<(), AgentMailboxesError> {
        let response = Self::traced(
            self.0
                .client
                .post(self.agent_url(agent_user_id, "/release")),
        )
        .send()
        .await?;
        let status = response.status();
        if status == StatusCode::NO_CONTENT {
            return Ok(());
        }
        match response.json::<AgentMailboxErrorBody>().await {
            Ok(body) => Err(AgentMailboxesError::Refused { status, body }),
            Err(_) => Err(AgentMailboxesError::Unexpected(status)),
        }
    }
}
