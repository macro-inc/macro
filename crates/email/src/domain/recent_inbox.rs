//! Recent mail across a user's own mailboxes, read straight from Gmail and
//! Outlook before Macro has synchronized them: the newest inbox messages or
//! the last days of inbox or sent mail, with text for only the newest.

use std::future::Future;

use chrono::{DateTime, Duration, Utc};
use email_api_client::domain::models::EmailApiError;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::email::service::message::{
    RecentInboxMessage, UnreadableMailbox, UnreadableMailboxReason,
};
use models_email::service::link::UserProvider;
use tracing::{Instrument, Span};

pub use models_email::email::service::message::RecentMailFolder;

use super::mailbox::{MailboxError, MailboxKey};

#[cfg(test)]
mod test;

/// Messages one read returns when a caller doesn't say.
pub const DEFAULT_RECENT_MESSAGES: u16 = 50;
/// Most messages one read returns: routine suggestions read 100 to learn
/// what the person's work looks like. More adds provider reads without
/// telling a reader much more about the inbox.
pub const MAX_RECENT_MESSAGES: u16 = 100;
/// Longest subject returned, in characters.
const MAX_SUBJECT_CHARS: usize = 200;
/// Snippet length when a caller doesn't say: the provider's preview.
pub const DEFAULT_SNIPPET_CHARS: u16 = 300;
/// The longest snippet a caller may ask for, filled from the body when the
/// provider's preview is shorter.
pub const MAX_SNIPPET_CHARS: u16 = 500;
/// The most days a window read reaches back: routine suggestions read a
/// month to find the work that recurs in it.
pub const MAX_WINDOW_DAYS: u16 = 30;
/// Most messages one window read returns, across inboxes.
pub const MAX_WINDOW_MESSAGES: u16 = 500;

/// What one mailbox read asks its provider for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecentRead {
    /// Folder to read.
    pub folder: RecentMailFolder,
    /// Messages at most.
    pub limit: u16,
    /// Only messages received at or after this time, when given.
    pub since: Option<DateTime<Utc>>,
}

/// A read of the messages of the last `days` days.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowRead {
    /// Folder to read across the actor's mailboxes.
    pub folder: RecentMailFolder,
    /// 1 to [`MAX_WINDOW_DAYS`].
    pub days: u16,
    /// 1 to [`MAX_WINDOW_MESSAGES`].
    pub limit: u16,
    /// How many of the newest carry a snippet; one at or past `limit`
    /// gives every kept message its snippet, and the rest carry none.
    pub texts: u16,
    /// 1 to [`MAX_SNIPPET_CHARS`].
    pub snippet_chars: u16,
}

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

/// A recent-mail read failure, distinguished before best-effort aggregation.
#[derive(Debug, thiserror::Error)]
pub enum RecentInboxReadError {
    /// The provider cannot fulfill this read shape.
    #[error("the requested recent-mail window is unsupported")]
    Unsupported,
    /// An attempted provider read failed.
    #[error(transparent)]
    Provider(#[from] EmailApiError),
}

pub trait RecentInboxReader: Send + Sync + 'static {
    /// Up to `read.limit` messages from `read.folder`, newest first,
    /// dated no earlier than `read.since` when it is given.
    fn recent(
        &self,
        mailbox: &RecentInboxMailbox,
        read: RecentRead,
    ) -> impl Future<Output = Result<Vec<RecentInboxMessage>, RecentInboxReadError>> + Send;
}

/// What the service reads, past its callers' clamps.
#[derive(Debug, Clone, Copy)]
struct Read {
    folder: RecentMailFolder,
    limit: u16,
    /// The window's length, when it is one.
    days: Option<u16>,
    since: Option<DateTime<Utc>>,
    texts: u16,
    snippet_chars: u16,
}

/// Best-effort mail with the mailboxes omitted from this requested context.
#[derive(Debug)]
pub struct RecentInboxResult {
    /// Healthy mailboxes’ messages, ordered and capped for the request.
    pub messages: Vec<RecentInboxMessage>,
    /// Typed omissions; an empty messages list alone does not imply empty mail.
    pub unreadable_mailboxes: Vec<UnreadableMailbox>,
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
    /// across the actor's own inboxes, newest first, with snippets of up to
    /// `snippet_chars` (1 to [`MAX_SNIPPET_CHARS`]): past the provider's
    /// preview, taken from the body. An inbox that cannot be read is skipped
    /// and logged, so one revoked grant does not hide the others.
    pub async fn read(
        &self,
        actor: &MacroUserIdStr<'_>,
        limit: u16,
        snippet_chars: u16,
    ) -> Result<RecentInboxResult, MailboxError> {
        let limit = limit.clamp(1, MAX_RECENT_MESSAGES);
        self.read_messages(
            actor,
            Read {
                folder: RecentMailFolder::Inbox,
                limit,
                days: None,
                since: None,
                texts: limit,
                snippet_chars,
            },
        )
        .await
    }

    /// The messages in `window.folder` across the actor's own mailboxes in
    /// the `window.days` days before `now`, newest first, at most
    /// `window.limit` of them, read as [`Self::read`] reads. Only the newest
    /// `window.texts` carry a snippet: a reader of a month needs every
    /// message's sender, subject and date, and the text of the newest.
    pub async fn read_window(
        &self,
        actor: &MacroUserIdStr<'_>,
        window: WindowRead,
        now: DateTime<Utc>,
    ) -> Result<RecentInboxResult, MailboxError> {
        let days = window.days.clamp(1, MAX_WINDOW_DAYS);
        let limit = window.limit.clamp(1, MAX_WINDOW_MESSAGES);
        self.read_messages(
            actor,
            Read {
                folder: window.folder,
                limit,
                days: Some(days),
                since: Some(now - Duration::days(i64::from(days))),
                texts: window.texts.min(limit),
                snippet_chars: window.snippet_chars,
            },
        )
        .await
    }

    #[tracing::instrument(
        name = "email.recent_inbox",
        skip_all,
        fields(
            folder = read.folder.as_ref(),
            limit = i64::from(read.limit),
            snippet_chars = i64::from(read.snippet_chars),
            days = read.days.map(i64::from),
            texts = i64::from(read.texts),
            inbox_count = tracing::field::Empty,
            failed_inbox_count = tracing::field::Empty,
            unsupported_inbox_count = tracing::field::Empty,
            message_count = tracing::field::Empty,
        ),
        err
    )]
    async fn read_messages(
        &self,
        actor: &MacroUserIdStr<'_>,
        read: Read,
    ) -> Result<RecentInboxResult, MailboxError> {
        let snippet_chars = usize::from(read.snippet_chars.clamp(1, MAX_SNIPPET_CHARS));
        let inboxes = self.repository.readable_owned_inboxes(actor).await?;
        let span = Span::current();
        span.record("inbox_count", span_count(inboxes.len()));

        let asked = RecentRead {
            folder: read.folder,
            limit: read.limit,
            since: read.since,
        };
        let reads = futures::future::join_all(
            inboxes
                .iter()
                .map(|inbox| self.read_inbox(inbox, asked, &span)),
        )
        .await;

        let mut messages = Vec::new();
        let mut unreadable_mailboxes = Vec::new();
        for read in reads {
            match read {
                Ok(read) => messages.extend(read),
                Err(unreadable) => unreadable_mailboxes.push(unreadable),
            }
        }

        // A provider may answer a little past the window's start; a message
        // with no date can't be placed in it.
        if let Some(since) = read.since {
            messages.retain(|message| message.received_at.is_some_and(|at| at >= since));
        }
        messages.sort_by(|a, b| b.received_at.cmp(&a.received_at));
        messages.truncate(usize::from(read.limit));
        for (index, message) in messages.iter_mut().enumerate() {
            cap(&mut message.subject, MAX_SUBJECT_CHARS);
            let body = message.body.take();
            if index >= usize::from(read.texts) {
                message.snippet = None;
                continue;
            }
            if snippet_chars > usize::from(DEFAULT_SNIPPET_CHARS)
                && let Some(body) = body.map(|body| collapse(&body))
                && body.chars().count()
                    > message.snippet.as_deref().map_or(0, |s| s.chars().count())
            {
                message.snippet = Some(body);
            }
            cap(&mut message.snippet, snippet_chars);
        }

        let failed = unreadable_mailboxes
            .iter()
            .filter(|mailbox| mailbox.reason == UnreadableMailboxReason::ProviderError)
            .count();
        span.record("failed_inbox_count", span_count(failed));
        span.record(
            "unsupported_inbox_count",
            span_count(unreadable_mailboxes.len() - failed),
        );
        span.record("message_count", span_count(messages.len()));
        Ok(RecentInboxResult {
            messages,
            unreadable_mailboxes,
        })
    }

    /// One inbox's messages or its typed omission from the requested context.
    async fn read_inbox(
        &self,
        inbox: &RecentInboxMailbox,
        read: RecentRead,
        parent: &Span,
    ) -> Result<Vec<RecentInboxMessage>, UnreadableMailbox> {
        let span = tracing::info_span!(
            parent: parent,
            "email.recent_inbox.inbox",
            link_id = %inbox.key.link_id,
            provider = ?inbox.provider,
            message_count = tracing::field::Empty,
            unreadable_reason = tracing::field::Empty,
            otel.status_code = tracing::field::Empty,
        );

        match self
            .reader
            .recent(inbox, read)
            .instrument(span.clone())
            .await
        {
            Ok(messages) => {
                span.record("message_count", span_count(messages.len()));
                Ok(messages)
            }
            Err(error) => {
                let reason = match error {
                    RecentInboxReadError::Unsupported => UnreadableMailboxReason::Unsupported,
                    RecentInboxReadError::Provider(error) => {
                        span.record("otel.status_code", "ERROR");
                        tracing::warn!(
                            parent: &span,
                            link_id = %inbox.key.link_id,
                            provider = ?inbox.provider,
                            error = %error,
                            "could not read recent messages; skipping the mailbox"
                        );
                        UnreadableMailboxReason::ProviderError
                    }
                };
                span.record("unreadable_reason", tracing::field::debug(reason));
                Err(UnreadableMailbox {
                    link_id: inbox.key.link_id,
                    reason,
                })
            }
        }
    }
}

/// Keeps at most `max` characters.
/// `text` with each run of whitespace as one space.
fn collapse(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

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
