//! Storage and provider adapters for reading a user's recent mail
//! straight from Gmail and Outlook.

use std::future::Future;
use std::time::Duration;

use chrono::{DateTime, Utc};
use email::domain::mailbox::{MailboxError, MailboxKey};
use email::domain::recent_inbox::{
    RecentInboxMailbox, RecentInboxMailboxes, RecentInboxReader, RecentMailFolder, RecentRead,
};
use email_api_client::GmailApiClientRepository;
use email_api_client::domain::{
    models::{EmailApiError, MailboxAccess, RateLimitOrigin},
    ports::{
        MailboxContentReader, MailboxTokenSource, ProviderRateLimiter, ProviderRequestGate,
        ProviderTokenSource, ScopedMailboxRepository,
    },
    service::{EmailApiClientServiceImpl, mailbox::MailboxApiService},
};
use futures::StreamExt;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::email::service::label::system_labels;
use models_email::email::service::message::{Message, RecentInboxMessage};
use models_email::service::link::UserProvider;
use tokio::time::Instant;
use uuid::Uuid;

use super::email_api::GmailApi;

#[cfg(test)]
mod test;

/// Gmail message reads in flight per inbox. Stays under the Gmail gate's five
/// requests per mailbox, leaving room for sync.
const GMAIL_READS_PER_INBOX: usize = 3;
/// How long a window read keeps starting reads, from its list on. Its list
/// and up to 500 reads cost about 2,500 quota units, more than one 10-second
/// window of the backfill share of a mailbox's allowance (1,800), so the
/// reads that don't fit wait out the gate's refusals for the next window. A
/// read not started by then is left out; one running then finishes, so the
/// whole read can run past this by one read's own calls.
const GMAIL_WINDOW_WAIT: Duration = Duration::from_secs(45);
/// The wait after a refusal that names none.
const GMAIL_REFUSED_RETRY: Duration = Duration::from_secs(1);

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
    /// For the newest few, read at once within the live share.
    pub gmail: GmailApi,
    /// For a window of days, bulk work that takes the backfill share of the
    /// mailbox's allowance, so sync and user writes keep the slots and units
    /// held for them.
    pub gmail_window: GmailApi,
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
        read: RecentRead,
    ) -> Result<Vec<RecentInboxMessage>, EmailApiError> {
        let messages = match mailbox.provider {
            UserProvider::Gmail => {
                gmail_recent_messages(&self.gmail, &self.gmail_window, mailbox.key.link_id, read)
                    .await?
            }
            UserProvider::Outlook => self
                .outlook
                .recent_inbox_messages(
                    MailboxAccess {
                        link_id: mailbox.key.link_id,
                        sync_generation: mailbox.key.sync_generation,
                        grant_generation: mailbox.key.grant_generation,
                    },
                    read.folder,
                    read.limit,
                    read.since,
                    &[],
                )
                .await?
                .into_iter()
                .map(|message| message.content.message)
                .collect(),
        };

        // Each message is dated the way its provider's list was filtered:
        // Gmail's `after:` reads the message's internal date, Graph's sent
        // window its `sentDateTime`.
        let dated_by_sending =
            mailbox.provider == UserProvider::Outlook && read.folder == RecentMailFolder::Sent;
        Ok(messages
            .into_iter()
            .map(|message| summarize(&mailbox.email_address, message, dated_by_sending))
            .collect())
    }
}

/// Lists the newest message ids, dated since `read.since` when it is given,
/// then reads each message, newest first. A message that fails to read is
/// left out and counted. A window read goes through `gmail_window` and waits
/// out the gate's refusals for [`GMAIL_WINDOW_WAIT`] from its list. The
/// newest few use `gmail_live` and are refused at once.
async fn gmail_recent_messages<T: ProviderTokenSource, L: ProviderRequestGate>(
    gmail_live: &EmailApiClientServiceImpl<GmailApiClientRepository, T, L>,
    gmail_window: &EmailApiClientServiceImpl<GmailApiClientRepository, T, L>,
    link_id: Uuid,
    read: RecentRead,
) -> Result<Vec<Message>, EmailApiError> {
    let limit = u32::from(read.limit);
    let (gmail, ids, deadline) = match read.since {
        Some(since) => {
            let deadline = Instant::now() + GMAIL_WINDOW_WAIT;
            let label = match read.folder {
                RecentMailFolder::Inbox => system_labels::INBOX,
                RecentMailFolder::Sent => system_labels::SENT,
            };
            let labels = [label];
            let ids = wait_out_refusals(Some(deadline), || {
                gmail_window.list_messages_since(link_id, limit, &labels, since)
            })
            .await?;
            (gmail_window, ids, Some(deadline))
        }
        None => (
            gmail_live,
            gmail_live
                .list_messages(link_id, limit, &[system_labels::INBOX])
                .await?,
            None,
        ),
    };
    let reads: Vec<_> =
        futures::stream::iter(ids)
            .map(|id| async move {
                wait_out_refusals(deadline, || gmail.get_message(link_id, &id)).await
            })
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

/// Runs `read` until it is not refused. Until `deadline`, a refusal by the
/// gate or by Gmail's rate limit waits as long as it asks (or
/// [`GMAIL_REFUSED_RETRY`]) and tries again; a refusal whose wait would
/// reach the deadline, or any refusal without one, is the answer. No try
/// starts at or after the deadline. One still running then finishes, within
/// the client's own timeouts and with the calls it is made of (the list's
/// later pages, a token refresh): cutting it off could drop the gate's
/// admission after Redis granted it and before its permit exists, holding a
/// slot of the mailbox until the lease runs out.
async fn wait_out_refusals<O, F, Fut>(
    deadline: Option<Instant>,
    mut read: F,
) -> Result<O, EmailApiError>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<O, EmailApiError>>,
{
    let refused = || EmailApiError::RateLimited {
        retry_after: None,
        origin: RateLimitOrigin::Local,
    };
    loop {
        if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            return Err(refused());
        }
        match read().await {
            Err(EmailApiError::RateLimited {
                retry_after,
                origin,
            }) => {
                let wait = retry_after.unwrap_or(GMAIL_REFUSED_RETRY);
                // Compared with what is left, so no Retry-After overflows the clock.
                let left =
                    deadline.map(|deadline| deadline.saturating_duration_since(Instant::now()));
                match left {
                    Some(left) if wait < left => tokio::time::sleep(wait).await,
                    _ => {
                        return Err(EmailApiError::RateLimited {
                            retry_after,
                            origin,
                        });
                    }
                }
            }
            read => return read,
        }
    }
}

/// The date a window reads a message by: when it was sent where its list was
/// filtered by that, otherwise its provider's own date (arrival, or Gmail's
/// internal date), each falling back on the other.
fn window_date(
    internal: Option<DateTime<Utc>>,
    sent: Option<DateTime<Utc>>,
    dated_by_sending: bool,
) -> Option<DateTime<Utc>> {
    if dated_by_sending {
        sent.or(internal)
    } else {
        internal.or(sent)
    }
}

fn summarize(inbox: &str, message: Message, dated_by_sending: bool) -> RecentInboxMessage {
    let received_at = window_date(message.internal_date_ts, message.sent_at, dated_by_sending);
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
        received_at,
        labels: message
            .labels
            .into_iter()
            .map(|label| label.name.unwrap_or(label.provider_label_id))
            .collect(),
        body: message.body_text,
    }
}
