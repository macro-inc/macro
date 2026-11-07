//! The newest messages across a user's own inboxes, read straight from Gmail
//! and Outlook so they can be read before Macro has synchronized the mailbox.

use std::future::Future;

use email_api_client_core::models::EmailApiError;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::email::service::message::RecentInboxMessage;
use models_email::service::link::UserProvider;
use tracing::{Instrument, Span};

use super::mailbox::{MailboxError, MailboxKey};

#[cfg(test)]
mod test;

/// Most messages one read returns. More adds provider reads without telling a
/// reader much more about the inbox.
pub const MAX_RECENT_MESSAGES: u16 = 50;
/// Longest subject returned, in characters.
const MAX_SUBJECT_CHARS: usize = 200;
/// Longest snippet returned, in characters.
const MAX_SNIPPET_CHARS: usize = 300;

/// One of the user's own inboxes, bound to its current credentials.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecentInboxMailbox {
    pub key: MailboxKey,
    pub provider: UserProvider,
    /// The inbox address, copied onto each message read from it.
    pub email_address: String,
}

pub trait RecentInboxMailboxes: Send + Sync + 'static {
    /// The actor's own syncing inboxes whose credentials still work. Inboxes
    /// delegated to them belong to someone else and are left out.
    fn readable_owned_inboxes(
        &self,
        actor: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<RecentInboxMailbox>, MailboxError>> + Send;
}

pub trait RecentInboxReader: Send + Sync + 'static {
    /// Up to `limit` of the inbox's newest messages, newest first.
    fn recent(
        &self,
        mailbox: &RecentInboxMailbox,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<RecentInboxMessage>, EmailApiError>> + Send;
}

pub struct RecentInboxService<R, P> {
    repository: R,
    reader: P,
}

impl<R, P> RecentInboxService<R, P> {
    pub fn new(repository: R, reader: P) -> Self {
        Self { repository, reader }
    }
}

impl<R: RecentInboxMailboxes, P: RecentInboxReader> RecentInboxService<R, P> {
    /// Up to `limit` (1 to [`MAX_RECENT_MESSAGES`]) of the newest messages
    /// across the actor's own inboxes, newest first. An inbox that cannot be
    /// read is skipped and logged, so one revoked grant does not hide the
    /// others.
    #[tracing::instrument(
        name = "email.recent_inbox",
        skip_all,
        fields(
            limit = i64::from(limit),
            inbox_count = tracing::field::Empty,
            failed_inbox_count = tracing::field::Empty,
            message_count = tracing::field::Empty,
        ),
        err
    )]
    pub async fn read(
        &self,
        actor: &MacroUserIdStr<'_>,
        limit: u16,
    ) -> Result<Vec<RecentInboxMessage>, MailboxError> {
        let limit = limit.clamp(1, MAX_RECENT_MESSAGES);
        let inboxes = self.repository.readable_owned_inboxes(actor).await?;
        let span = Span::current();
        span.record("inbox_count", span_count(inboxes.len()));

        let reads = futures::future::join_all(
            inboxes
                .iter()
                .map(|inbox| self.read_inbox(inbox, limit, &span)),
        )
        .await;

        let mut messages = Vec::new();
        let mut failed = 0usize;
        for read in reads {
            match read {
                Some(read) => messages.extend(read),
                None => failed += 1,
            }
        }

        messages.sort_by(|a, b| b.received_at.cmp(&a.received_at));
        messages.truncate(usize::from(limit));
        for message in &mut messages {
            cap(&mut message.subject, MAX_SUBJECT_CHARS);
            cap(&mut message.snippet, MAX_SNIPPET_CHARS);
        }

        span.record("failed_inbox_count", span_count(failed));
        span.record("message_count", span_count(messages.len()));
        Ok(messages)
    }

    /// One inbox's newest messages, or `None` when the provider read failed.
    async fn read_inbox(
        &self,
        inbox: &RecentInboxMailbox,
        limit: u16,
        parent: &Span,
    ) -> Option<Vec<RecentInboxMessage>> {
        let span = tracing::info_span!(
            parent: parent,
            "email.recent_inbox.inbox",
            link_id = %inbox.key.link_id,
            provider = ?inbox.provider,
            message_count = tracing::field::Empty,
            otel.status_code = tracing::field::Empty,
        );

        match self
            .reader
            .recent(inbox, limit)
            .instrument(span.clone())
            .await
        {
            Ok(messages) => {
                span.record("message_count", span_count(messages.len()));
                Some(messages)
            }
            Err(error) => {
                span.record("otel.status_code", "ERROR");
                tracing::warn!(
                    parent: &span,
                    link_id = %inbox.key.link_id,
                    provider = ?inbox.provider,
                    error = %error,
                    "could not read recent inbox messages; skipping the inbox"
                );
                None
            }
        }
    }
}

/// Keeps at most `max` characters.
fn cap(text: &mut Option<String>, max: usize) {
    if let Some(text) = text
        && let Some((end, _)) = text.char_indices().nth(max)
    {
        text.truncate(end);
    }
}

/// Span numbers are `i64`: OpenTelemetry receives unsigned fields as strings.
fn span_count(count: usize) -> i64 {
    i64::try_from(count).unwrap_or(i64::MAX)
}
