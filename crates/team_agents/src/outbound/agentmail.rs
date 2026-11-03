//! AgentMail adapter: one inbox per team agent.
//!
//! API reference: <https://docs.agentmail.to/api-reference>.

use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize, de::DeserializeOwned};

use crate::domain::models::{
    EmailMessage, EmailMessages, Mailbox, SendEmail, SentEmail, TeamAgentError,
};
use crate::domain::ports::Mailboxes;

const AGENTMAIL_API: &str = "https://api.agentmail.to/v0";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

/// Domain for agent addresses when no email provider is configured. Reserved
/// by RFC 2606, so nothing can ever deliver to it.
const PLACEHOLDER_DOMAIN: &str = "agents.macro.invalid";

/// AgentMail credentials.
#[derive(Clone)]
pub struct AgentMailConfig {
    /// API key.
    pub api_key: String,
    /// Verified custom domain for addresses; AgentMail's own when `None`.
    pub domain: Option<String>,
}

impl std::fmt::Debug for AgentMailConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AgentMailConfig")
            .field("domain", &self.domain)
            .finish_non_exhaustive()
    }
}

/// Agents' mailboxes at AgentMail. Without a config, agents get a placeholder
/// address and no inbox, and every mailbox call answers `EmailUnavailable`.
#[derive(Clone)]
pub struct AgentMail {
    client: reqwest::Client,
    config: Option<AgentMailConfig>,
}

/// Errors talking to AgentMail.
#[derive(Debug, thiserror::Error)]
pub enum AgentMailError {
    /// The request failed to send or decode.
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    /// AgentMail answered with an error status.
    #[error("agentmail answered {status}: {body}")]
    Status {
        /// HTTP status.
        status: reqwest::StatusCode,
        /// Response body.
        body: String,
    },
}

impl From<AgentMailError> for TeamAgentError {
    fn from(error: AgentMailError) -> Self {
        TeamAgentError::EmailProvider(rootcause::Report::new(error).into_dynamic())
    }
}

#[derive(Serialize)]
struct CreateInbox<'a> {
    username: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    domain: Option<&'a str>,
    display_name: &'a str,
}

#[derive(Deserialize)]
struct Inbox {
    inbox_id: String,
    email: String,
}

#[derive(Deserialize)]
struct Message {
    message_id: String,
    thread_id: String,
    from: String,
    #[serde(default)]
    to: Vec<String>,
    subject: Option<String>,
    preview: Option<String>,
    extracted_text: Option<String>,
    text: Option<String>,
    timestamp: DateTime<Utc>,
}

impl From<Message> for EmailMessage {
    fn from(message: Message) -> Self {
        EmailMessage {
            message_id: message.message_id,
            thread_id: message.thread_id,
            from: message.from,
            to: message.to,
            subject: message.subject,
            preview: message.preview,
            text: message.extracted_text.or(message.text),
            received_at: message.timestamp,
        }
    }
}

#[derive(Deserialize)]
struct MessageList {
    messages: Vec<Message>,
}

#[derive(Deserialize)]
struct Sent {
    message_id: String,
}

impl AgentMail {
    /// Builds the adapter; `None` turns email off.
    pub fn new(config: Option<AgentMailConfig>) -> Result<Self, AgentMailError> {
        let client = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()?;

        Ok(Self { client, config })
    }

    fn config(&self) -> Result<&AgentMailConfig, TeamAgentError> {
        self.config.as_ref().ok_or(TeamAgentError::EmailUnavailable)
    }

    async fn call<T: DeserializeOwned>(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<T, TeamAgentError> {
        let config = self.config()?;
        let response = request
            .bearer_auth(&config.api_key)
            .send()
            .await
            .map_err(AgentMailError::from)?;
        let status = response.status();

        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(AgentMailError::Status { status, body }.into());
        }

        Ok(response.json().await.map_err(AgentMailError::from)?)
    }
}

impl Mailboxes for AgentMail {
    #[tracing::instrument(name = "team_agents.mailbox.create", skip_all, err)]
    async fn create(&self, username: &str, display_name: &str) -> Result<Mailbox, TeamAgentError> {
        let Some(config) = &self.config else {
            return Ok(Mailbox {
                mailbox_id: None,
                email: format!("{username}@{PLACEHOLDER_DOMAIN}"),
            });
        };

        let inbox: Inbox = self
            .call(
                self.client
                    .post(format!("{AGENTMAIL_API}/inboxes"))
                    .json(&CreateInbox {
                        username,
                        domain: config.domain.as_deref(),
                        display_name,
                    }),
            )
            .await?;

        Ok(Mailbox {
            mailbox_id: Some(inbox.inbox_id),
            email: inbox.email,
        })
    }

    #[tracing::instrument(name = "team_agents.mailbox.delete", skip_all, err)]
    async fn delete(&self, mailbox_id: &str) -> Result<(), TeamAgentError> {
        let config = self.config()?;
        let response = self
            .client
            .delete(format!("{AGENTMAIL_API}/inboxes/{mailbox_id}"))
            .bearer_auth(&config.api_key)
            .send()
            .await
            .map_err(AgentMailError::from)?;
        let status = response.status();

        if !status.is_success() && status != reqwest::StatusCode::NOT_FOUND {
            let body = response.text().await.unwrap_or_default();
            return Err(AgentMailError::Status { status, body }.into());
        }

        Ok(())
    }

    #[tracing::instrument(name = "team_agents.mailbox.list", skip(self), err)]
    async fn list(&self, mailbox_id: &str, limit: u8) -> Result<EmailMessages, TeamAgentError> {
        let list: MessageList = self
            .call(
                self.client
                    .get(format!("{AGENTMAIL_API}/inboxes/{mailbox_id}/messages"))
                    .query(&[("limit", limit)]),
            )
            .await?;

        Ok(EmailMessages {
            messages: list.messages.into_iter().map(EmailMessage::from).collect(),
        })
    }

    #[tracing::instrument(name = "team_agents.mailbox.get", skip(self), err)]
    async fn get(
        &self,
        mailbox_id: &str,
        message_id: &str,
    ) -> Result<EmailMessage, TeamAgentError> {
        let message: Message = self
            .call(self.client.get(format!(
                "{AGENTMAIL_API}/inboxes/{mailbox_id}/messages/{message_id}"
            )))
            .await?;

        Ok(message.into())
    }

    #[tracing::instrument(name = "team_agents.mailbox.send", skip(self, email), err)]
    async fn send(&self, mailbox_id: &str, email: &SendEmail) -> Result<SentEmail, TeamAgentError> {
        let sent: Sent = self
            .call(
                self.client
                    .post(format!(
                        "{AGENTMAIL_API}/inboxes/{mailbox_id}/messages/send"
                    ))
                    .json(&serde_json::json!({
                        "to": email.to,
                        "subject": email.subject,
                        "text": email.text,
                        "html": email.html,
                    })),
            )
            .await?;

        Ok(SentEmail {
            message_id: sent.message_id,
        })
    }
}
