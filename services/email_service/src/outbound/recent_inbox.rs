//! Storage and provider adapters for reading a user's newest inbox messages
//! straight from Gmail and Outlook.

use email::domain::mailbox::{MailboxError, MailboxKey};
use email::domain::recent_inbox::{RecentInboxMailbox, RecentInboxMailboxes, RecentInboxReader};
use email_api_client::domain::{
    models::{EmailApiError, MailboxAccess},
    ports::{
        MailboxContentReader, MailboxTokenSource, ProviderRateLimiter, ScopedMailboxRepository,
    },
    service::mailbox::MailboxApiService,
};
use futures::StreamExt;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::email::service::message::{Message, RecentInboxMessage};
use models_email::service::link::UserProvider;
use uuid::Uuid;

use super::email_api::GmailApi;

/// Gmail message reads in flight per inbox. Stays under the Gmail gate's five
/// live requests per mailbox, leaving room for sync.
const GMAIL_READS_PER_INBOX: usize = 3;

pub struct PgRecentInboxes(pub sqlx::PgPool);

impl RecentInboxMailboxes for PgRecentInboxes {
    async fn readable_owned_inboxes(
        &self,
        actor: &MacroUserIdStr<'_>,
    ) -> Result<Vec<RecentInboxMailbox>, MailboxError> {
        let inboxes = email_db_client::links::get::fetch_readable_owned_inboxes(&self.0, actor)
            .await
            .map_err(|_| MailboxError::Persistence)?;

        Ok(inboxes
            .into_iter()
            .map(|inbox| RecentInboxMailbox {
                key: MailboxKey {
                    link_id: inbox.id,
                    sync_generation: inbox.sync_generation,
                    grant_generation: inbox.grant_generation,
                },
                provider: inbox.provider,
                email_address: inbox.email_address,
            })
            .collect())
    }
}

/// Gmail reads take permits from the Gmail request gate; Graph reads go
/// through the Outlook transport's mailbox gate.
#[derive(Clone)]
pub struct ProviderRecentInbox<R, T, L> {
    pub gmail: GmailApi,
    pub outlook: MailboxApiService<R, T, L>,
}

impl<R, T, L> RecentInboxReader for ProviderRecentInbox<R, T, L>
where
    R: MailboxContentReader + ScopedMailboxRepository,
    T: MailboxTokenSource,
    L: ProviderRateLimiter,
{
    async fn recent(
        &self,
        mailbox: &RecentInboxMailbox,
        limit: u16,
    ) -> Result<Vec<RecentInboxMessage>, EmailApiError> {
        let messages = match mailbox.provider {
            UserProvider::Gmail => self.gmail_inbox(mailbox.key.link_id, limit).await?,
            UserProvider::Outlook => self
                .outlook
                .recent_inbox_messages(
                    MailboxAccess {
                        link_id: mailbox.key.link_id,
                        sync_generation: mailbox.key.sync_generation,
                        grant_generation: mailbox.key.grant_generation,
                    },
                    limit,
                    &[],
                )
                .await?
                .into_iter()
                .map(|message| message.content.message)
                .collect(),
        };

        Ok(messages
            .into_iter()
            .map(|message| summarize(&mailbox.email_address, message))
            .collect())
    }
}

impl<R, T, L> ProviderRecentInbox<R, T, L> {
    /// Lists the newest inbox ids, then reads each message. A message that
    /// fails to read is left out and counted, so one bad read keeps the rest.
    async fn gmail_inbox(&self, link_id: Uuid, limit: u16) -> Result<Vec<Message>, EmailApiError> {
        let ids = self
            .gmail
            .list_messages(link_id, u32::from(limit), &["INBOX"])
            .await?;
        let reads: Vec<_> = futures::stream::iter(ids)
            .map(|id| async move { self.gmail.get_message(link_id, &id).await })
            .buffered(GMAIL_READS_PER_INBOX)
            .collect()
            .await;

        let mut messages = Vec::new();
        let mut failed = 0usize;
        for read in reads {
            match read {
                Ok(Some(message)) => messages.push(message.message),
                Ok(None) => {}
                Err(error) => {
                    failed += 1;
                    tracing::debug!(%link_id, error = %error, "could not read a recent Gmail message");
                }
            }
        }

        if failed > 0 {
            tracing::warn!(%link_id, failed_message_count = failed, "left out recent Gmail messages that failed to read");
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
        labels: message
            .labels
            .into_iter()
            .map(|label| label.name.unwrap_or(label.provider_label_id))
            .collect(),
        body: message.body_text,
    }
}
