//! [`InboxReader`] over the email service, which reads Gmail and Outlook
//! directly instead of the synchronized mailbox.

use std::sync::Arc;

use email_service_client::EmailServiceClient;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::message::RecentInboxMessage;

use crate::domain::model::InboxMessage;
use crate::domain::ports::InboxReader;

/// The email service request failed. The client reports with `anyhow`, so
/// this keeps its message rather than its type.
#[derive(Debug, thiserror::Error)]
#[error("reading recent inbox messages failed: {0}")]
pub struct EmailInboxError(String);

/// Reads the top of a user's inboxes through the email service.
#[derive(Clone)]
pub struct EmailServiceInboxReader {
    client: Arc<EmailServiceClient>,
}

impl EmailServiceInboxReader {
    /// Builds the reader on the internal email service client.
    pub fn new(client: Arc<EmailServiceClient>) -> Self {
        Self { client }
    }
}

impl InboxReader for EmailServiceInboxReader {
    type Err = EmailInboxError;

    async fn recent_messages(
        &self,
        user: &MacroUserIdStr<'static>,
        limit: u16,
    ) -> Result<Vec<InboxMessage>, Self::Err> {
        let response = self
            .client
            .get_recent_inbox_messages(user.as_ref(), limit)
            .await
            .map_err(|error| EmailInboxError(format!("{error:#}")))?;
        Ok(response.messages.into_iter().map(inbox_message).collect())
    }
}

fn inbox_message(message: RecentInboxMessage) -> InboxMessage {
    let others = message
        .to
        .into_iter()
        .chain(message.cc)
        .filter(|address| !address.eq_ignore_ascii_case(&message.inbox))
        .collect();
    let (from_name, from_email) = match message.from {
        Some(from) => (from.name, Some(from.email)),
        None => (None, None),
    };
    InboxMessage {
        inbox: message.inbox,
        from_name,
        from_email,
        others,
        subject: message.subject,
        snippet: message.snippet,
        received_at: message.received_at,
    }
}
