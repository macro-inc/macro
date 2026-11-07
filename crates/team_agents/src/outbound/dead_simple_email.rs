//! Dead Simple Email adapter: one inbox per team agent.
//!
//! API reference: <https://deadsimple.email/openapi.yaml>. Every response is
//! wrapped as `{"data": ..., "meta": ...}`.

use crate::domain::mail::{MailMessageId, MailboxId};
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize, de::DeserializeOwned};

use crate::domain::models::{
    EmailMessage, EmailMessages, Mailbox, SendEmail, SentEmail, TeamAgentError,
};
use crate::domain::ports::Mailboxes;

const DEAD_SIMPLE_EMAIL_API: &str = "https://api.deadsimple.email/v1";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

/// Domain for agent addresses when no email provider is configured. Reserved
/// by RFC 2606, so nothing can ever deliver to it.
const PLACEHOLDER_DOMAIN: &str = "agents.macro.invalid";

/// Agents' mailboxes at Dead Simple Email. Without an API key, agents get a
/// placeholder address and no inbox, and every mailbox call answers
/// `EmailUnavailable`.
#[derive(Clone)]
pub struct DeadSimpleEmail {
    client: reqwest::Client,
    api_key: Option<reqwest::header::HeaderValue>,
}

/// Errors talking to Dead Simple Email.
#[derive(Debug, thiserror::Error)]
pub enum DeadSimpleEmailError {
    /// The request failed to send or decode.
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    /// A configured provider credential is empty or invalid as an HTTP header.
    #[error("the email provider credential is invalid")]
    InvalidCredential,
    /// Dead Simple Email answered with an error status.
    #[error("dead simple email answered {status}: {body}")]
    Status {
        /// HTTP status.
        status: reqwest::StatusCode,
        /// Response body.
        body: String,
    },
}

impl From<DeadSimpleEmailError> for TeamAgentError {
    fn from(error: DeadSimpleEmailError) -> Self {
        TeamAgentError::EmailProvider(rootcause::Report::new(error).into_dynamic())
    }
}

#[derive(Deserialize)]
struct Envelope<T> {
    data: T,
}

#[derive(Serialize)]
struct CreateInbox<'a> {
    local_part: &'a str,
    display_name: &'a str,
}

#[derive(Deserialize)]
struct Inbox {
    inbox_id: MailboxId,
    email: String,
}

#[derive(Deserialize)]
struct Message {
    message_id: MailMessageId,
    thread_id: crate::domain::mail::MailThreadId,
    from_email: String,
    from_name: Option<String>,
    #[serde(default)]
    to: Vec<String>,
    subject: Option<String>,
    snippet: Option<String>,
    text_body: Option<String>,
    received_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

impl From<Message> for EmailMessage {
    fn from(message: Message) -> Self {
        let from = match message.from_name {
            Some(name) if !name.is_empty() => format!("{name} <{}>", message.from_email),
            _ => message.from_email,
        };

        EmailMessage {
            message_id: message.message_id,
            thread_id: message.thread_id,
            from,
            to: message.to,
            subject: message.subject,
            preview: message.snippet,
            text: message.text_body,
            received_at: message.received_at.unwrap_or(message.created_at),
        }
    }
}

#[derive(Deserialize)]
struct MessageList {
    messages: Vec<Message>,
}

#[derive(Serialize)]
struct Send<'a> {
    to: &'a [String],
    subject: &'a str,
    text_body: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    html_body: Option<&'a str>,
}

#[derive(Deserialize)]
struct Sent {
    message_id: MailMessageId,
}

impl DeadSimpleEmail {
    /// Builds the adapter; no API key turns email off.
    pub fn new(api_key: Option<String>) -> Result<Self, DeadSimpleEmailError> {
        let api_key = api_key
            .map(|raw| {
                if raw.is_empty() {
                    return Err(DeadSimpleEmailError::InvalidCredential);
                }
                let mut header = reqwest::header::HeaderValue::from_str(&format!("Bearer {raw}"))
                    .map_err(|_| DeadSimpleEmailError::InvalidCredential)?;
                header.set_sensitive(true);
                Ok(header)
            })
            .transpose()?;
        let client = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()?;

        Ok(Self { client, api_key })
    }

    fn api_key(&self) -> Result<&reqwest::header::HeaderValue, TeamAgentError> {
        self.api_key
            .as_ref()
            .ok_or(TeamAgentError::EmailUnavailable)
    }

    async fn call<T: DeserializeOwned>(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<T, TeamAgentError> {
        let response = request
            .header(reqwest::header::AUTHORIZATION, self.api_key()?)
            .send()
            .await
            .map_err(DeadSimpleEmailError::from)?;
        let status = response.status();

        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(DeadSimpleEmailError::Status { status, body }.into());
        }

        let envelope: Envelope<T> = response.json().await.map_err(DeadSimpleEmailError::from)?;
        Ok(envelope.data)
    }
}

impl Mailboxes for DeadSimpleEmail {
    #[tracing::instrument(name = "team_agents.mailbox.create", skip_all, err)]
    async fn create(&self, username: &str, display_name: &str) -> Result<Mailbox, TeamAgentError> {
        if self.api_key.is_none() {
            return Ok(Mailbox {
                mailbox_id: None,
                email: format!("{username}@{PLACEHOLDER_DOMAIN}"),
            });
        }

        let inbox: Inbox = self
            .call(
                self.client
                    .post(format!("{DEAD_SIMPLE_EMAIL_API}/inboxes"))
                    .json(&CreateInbox {
                        local_part: username,
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
    async fn delete(&self, mailbox_id: &MailboxId) -> Result<(), TeamAgentError> {
        let response = self
            .client
            .delete(format!("{DEAD_SIMPLE_EMAIL_API}/inboxes/{mailbox_id}"))
            .header(reqwest::header::AUTHORIZATION, self.api_key()?)
            .send()
            .await
            .map_err(DeadSimpleEmailError::from)?;
        let status = response.status();

        if !status.is_success() && status != reqwest::StatusCode::NOT_FOUND {
            let body = response.text().await.unwrap_or_default();
            return Err(DeadSimpleEmailError::Status { status, body }.into());
        }

        Ok(())
    }

    #[tracing::instrument(name = "team_agents.mailbox.list", skip_all, err)]
    async fn list(
        &self,
        mailbox_id: &MailboxId,
        limit: u8,
    ) -> Result<EmailMessages, TeamAgentError> {
        let list: MessageList = self
            .call(
                self.client
                    .get(format!(
                        "{DEAD_SIMPLE_EMAIL_API}/inboxes/{mailbox_id}/messages"
                    ))
                    .query(&[("limit", limit)]),
            )
            .await?;

        Ok(EmailMessages {
            messages: list.messages.into_iter().map(EmailMessage::from).collect(),
        })
    }

    #[tracing::instrument(name = "team_agents.mailbox.get", skip_all, err)]
    async fn get(
        &self,
        mailbox_id: &MailboxId,
        message_id: &MailMessageId,
    ) -> Result<EmailMessage, TeamAgentError> {
        let message: Message = self
            .call(self.client.get(format!(
                "{DEAD_SIMPLE_EMAIL_API}/inboxes/{mailbox_id}/messages/{message_id}"
            )))
            .await?;

        Ok(message.into())
    }

    #[tracing::instrument(name = "team_agents.mailbox.send", skip_all, err)]
    async fn send(
        &self,
        mailbox_id: &MailboxId,
        email: &SendEmail,
    ) -> Result<SentEmail, TeamAgentError> {
        let sent: Sent = self
            .call(
                self.client
                    .post(format!(
                        "{DEAD_SIMPLE_EMAIL_API}/inboxes/{mailbox_id}/messages"
                    ))
                    .json(&Send {
                        to: &email.to,
                        subject: &email.subject,
                        text_body: &email.text,
                        html_body: email.html.as_deref(),
                    }),
            )
            .await?;

        Ok(SentEmail {
            message_id: sent.message_id,
        })
    }
}
