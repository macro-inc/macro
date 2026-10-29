//! A quick look at the top of a user's inboxes, read straight from Gmail and
//! Outlook so it works before Macro has synchronized the mailbox.

use email_api_client::domain::models::{EmailApiError, MailboxAccess};
use futures::{StreamExt, stream};
use macro_user_id::user_id::MacroUserIdStr;
use models_email::email::service::message::{Message, RecentInboxMessage};
use models_email::service::link::UserProvider;

use crate::api::context::OutlookApi;
use crate::outbound::email_api::GmailApi;

/// Gmail message reads run this many at a time per inbox.
const GMAIL_READ_CONCURRENCY: usize = 8;

/// Reads the newest inbox messages for a user across their own inboxes.
#[derive(Clone)]
pub struct RecentInboxReader {
    pub db: sqlx::PgPool,
    pub gmail: GmailApi,
    pub outlook: OutlookApi,
}

impl RecentInboxReader {
    /// Up to `limit` of the newest messages across the user's own inboxes,
    /// newest first. An inbox that cannot be read is skipped and logged, so
    /// one revoked grant does not hide the others.
    #[tracing::instrument(skip(self), fields(inbox_count = tracing::field::Empty), err)]
    pub async fn read(
        &self,
        user: &MacroUserIdStr<'_>,
        limit: u16,
    ) -> anyhow::Result<Vec<RecentInboxMessage>> {
        let inboxes =
            email_db_client::links::get::fetch_readable_owned_inboxes(&self.db, user).await?;
        tracing::Span::current().record("inbox_count", inboxes.len());
        let mut messages = Vec::new();
        for inbox in inboxes {
            let read = match inbox.provider {
                UserProvider::Gmail => self.gmail_inbox(inbox.id, limit).await,
                UserProvider::Outlook => self
                    .outlook
                    .recent_inbox_messages(
                        MailboxAccess {
                            link_id: inbox.id,
                            sync_generation: inbox.sync_generation,
                            grant_generation: inbox.grant_generation,
                        },
                        limit,
                        &[],
                    )
                    .await
                    .map(|messages| {
                        messages
                            .into_iter()
                            .map(|message| message.content.message)
                            .collect()
                    }),
            };
            match read {
                Ok(read) => messages.extend(
                    read.into_iter()
                        .map(|message| summarize(&inbox.email_address, message)),
                ),
                Err(error) => {
                    tracing::warn!(link_id = %inbox.id, error = ?error, "could not read recent inbox messages");
                }
            }
        }
        messages.sort_by(|a, b| b.received_at.cmp(&a.received_at));
        messages.truncate(usize::from(limit));
        Ok(messages)
    }

    async fn gmail_inbox(
        &self,
        link_id: uuid::Uuid,
        limit: u16,
    ) -> Result<Vec<Message>, EmailApiError> {
        let ids = self
            .gmail
            .list_messages(link_id, u32::from(limit), &["INBOX"])
            .await?;
        let reads: Vec<_> = stream::iter(ids)
            .map(|id| async move { self.gmail.get_message(link_id, &id).await })
            .buffered(GMAIL_READ_CONCURRENCY)
            .collect()
            .await;
        let mut messages = Vec::new();
        for read in reads {
            if let Some(message) = read? {
                messages.push(message.message);
            }
        }
        Ok(messages)
    }
}

fn summarize(inbox: &str, message: Message) -> RecentInboxMessage {
    RecentInboxMessage {
        inbox: inbox.to_owned(),
        from: message.from,
        to: message
            .to
            .into_iter()
            .map(|contact| contact.email)
            .collect(),
        cc: message
            .cc
            .into_iter()
            .map(|contact| contact.email)
            .collect(),
        subject: message.subject,
        snippet: message.snippet,
        received_at: message.internal_date_ts.or(message.sent_at),
    }
}
