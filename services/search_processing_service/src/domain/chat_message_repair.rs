//! Repair of chat messages that stay indexed after their message is deleted.
//!
//! A message deleted from a chat used to leave its document in the chats
//! index, where chat search still matches the chat through it. A backfill only
//! writes, so it cannot remove them. This job walks the index's message
//! documents in message id order, looks up their `ChatMessage` rows, and
//! deletes the documents whose row is gone. A dry run, the default, counts
//! them and deletes nothing.

use super::backfill_gate::BackfillGate;
use std::{collections::HashSet, num::NonZeroU32, sync::Arc, time::Duration};

use rootcause::Report;
use serde::Deserialize;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;
use tracing::field::Empty;

use super::{
    email_attachment_status::PageSize,
    jobs::{JobId, JobProgress, PageProgress},
    models::{BackfillError, BackfillReceipt},
};

#[cfg(test)]
mod test;

/// Indexed messages read per second when the request names no rate. Reads
/// and deletes are paced together, so a dry run loads the index and the
/// database as a real run does.
const DEFAULT_MESSAGES_PER_SECOND: NonZeroU32 = NonZeroU32::new(1000).expect("1000 is not zero");

/// Body of `POST /internal/backfill/deleted-chat-messages`.
#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct DeletedChatMessageRepairRequest {
    /// Count the documents whose message is gone without deleting them.
    pub dry_run: bool,
    /// Start after this message id: the `cursor` of a stopped or failed job.
    pub after_message_id: Option<String>,
    /// Indexed messages per page; 500 when omitted.
    pub page_size: Option<PageSize>,
    /// Most indexed messages read per second; 1000 when omitted.
    pub messages_per_second: Option<NonZeroU32>,
}

impl Default for DeletedChatMessageRepairRequest {
    fn default() -> Self {
        Self {
            dry_run: true,
            after_message_id: None,
            page_size: None,
            messages_per_second: None,
        }
    }
}

/// A message document in the chats index.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct IndexedChatMessage {
    pub chat_id: String,
    pub message_id: String,
}

/// What a batch of deletes did.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct MessageDelete {
    pub deleted: usize,
    /// Documents already gone, such as ones a live delete removed first.
    pub not_found: usize,
}

/// Why the index did not apply a batch of deletes.
#[derive(Debug, thiserror::Error)]
pub enum MessageIndexError {
    /// The index refused writes to protect itself (a 429 or a cluster block).
    /// Sending more makes it worse, so the job stops.
    #[error("{0}")]
    Refused(String),
    /// Some documents of the batch failed to delete. The job stops before its
    /// cursor moves past them, so a resume repeats the page; deleting again is
    /// harmless.
    #[error("{0}")]
    ItemsFailed(String),
    #[error("{0:?}")]
    Internal(Report),
}

/// The chats index's message documents.
pub trait ChatMessageIndex: Send + Sync + 'static {
    /// Up to `limit` message documents whose message id sorts after
    /// `after_message_id` (or from the first), in message id order. Empty
    /// once past the last one.
    fn page_after(
        &self,
        after_message_id: Option<&str>,
        limit: PageSize,
    ) -> impl Future<Output = Result<Vec<IndexedChatMessage>, MessageIndexError>> + Send;

    /// Delete these message documents, leaving their chats.
    fn delete(
        &self,
        messages: &[IndexedChatMessage],
    ) -> impl Future<Output = Result<MessageDelete, MessageIndexError>> + Send;
}

/// Reads of the chat tables.
pub trait ChatRows: Send + Sync + 'static {
    /// The ids among `message_ids` that have a `ChatMessage` row.
    fn existing_messages(
        &self,
        message_ids: &[String],
    ) -> impl Future<Output = Result<HashSet<String>, Report>> + Send;

    /// The ids among `chat_ids` that have a `Chat` row, trashed or not.
    fn existing_chats(
        &self,
        chat_ids: &[String],
    ) -> impl Future<Output = Result<HashSet<String>, Report>> + Send;
}

/// A page the job finished.
struct FinishedPage {
    last_message_id: String,
    read: usize,
    gone: usize,
    delete: MessageDelete,
}

/// The repair job. `replica` answers the lookup of every page; `primary`
/// confirms each message the replica does not have before it is deleted or
/// counted, so a lagging replica cannot remove a message just written.
pub struct DeletedChatMessageRepair<I, R> {
    index: I,
    replica: R,
    primary: R,
    gate: BackfillGate,
}

impl<I: ChatMessageIndex, R: ChatRows> DeletedChatMessageRepair<I, R> {
    pub fn new(index: I, replica: R, primary: R, gate: BackfillGate) -> Self {
        Self {
            index,
            replica,
            primary,
            gate,
        }
    }

    /// Walk every indexed message, page by page, until the walk ends, the job
    /// is cancelled, or the index refuses writes. Cancellation is checked
    /// between pages and ends a page's pause early.
    pub async fn repair(
        &self,
        req: DeletedChatMessageRepairRequest,
        progress: Arc<JobProgress>,
        cancel: CancellationToken,
    ) -> Result<BackfillReceipt, BackfillError> {
        let page_size = req.page_size.unwrap_or_default();
        let messages_per_second = req
            .messages_per_second
            .unwrap_or(DEFAULT_MESSAGES_PER_SECOND);
        let mut after_message_id = req.after_message_id;
        let mut read = 0;

        while !cancel.is_cancelled() {
            let permit = tokio::select! {
                biased;
                () = cancel.cancelled() => break,
                permit = self.gate.admit() => permit,
            };
            let started = Instant::now();
            let Some(page) = self
                .repair_page(
                    after_message_id.as_deref(),
                    page_size,
                    req.dry_run,
                    progress.job_id(),
                )
                .await?
            else {
                break;
            };
            drop(permit);

            progress
                .record_page(PageProgress {
                    cursor: &page.last_message_id,
                    processed: page.read,
                    updated: page.delete.deleted,
                    missing: page.gone,
                    failed: 0,
                })
                .await;
            read += page.read;
            after_message_id = Some(page.last_message_id);

            let resume_at = started + page_budget(page.read, messages_per_second);
            tokio::select! {
                () = tokio::time::sleep_until(resume_at) => {}
                () = cancel.cancelled() => {}
            }
        }

        Ok(BackfillReceipt {
            enqueued: read,
            ..BackfillReceipt::default()
        })
    }

    /// Read one page, find its messages whose row is gone, and delete their
    /// documents unless this is a dry run. `None` once the walk is past the
    /// last indexed message.
    #[tracing::instrument(
        name = "search.deleted_chat_messages.page",
        skip_all,
        fields(
            job_id = job_id.map(tracing::field::display),
            after_message_id,
            page_size = page_size.get(),
            dry_run,
            read = Empty,
            gone = Empty,
            gone_with_chat = Empty,
            gone_sample = Empty,
            deleted = Empty,
            not_found = Empty,
            last_message_id = Empty,
            outcome = Empty,
        ),
        err(Debug)
    )]
    async fn repair_page(
        &self,
        after_message_id: Option<&str>,
        page_size: PageSize,
        dry_run: bool,
        job_id: Option<&JobId>,
    ) -> Result<Option<FinishedPage>, BackfillError> {
        let span = tracing::Span::current();
        let source_failed = |e: Report| {
            span.record("outcome", "source_failed");
            BackfillError::Source(anyhow::anyhow!("{e:#}"))
        };

        let page = self
            .index
            .page_after(after_message_id, page_size)
            .await
            .map_err(|e| match e {
                MessageIndexError::Refused(reason) => {
                    span.record("outcome", "refused");
                    BackfillError::Stopped {
                        reason,
                        cursor: after_message_id.map(str::to_owned),
                    }
                }
                e => {
                    span.record("outcome", "index_read_failed");
                    BackfillError::Index(anyhow::anyhow!("{e}"))
                }
            })?;
        let Some(last) = page.last() else {
            span.record("outcome", "exhausted");
            return Ok(None);
        };
        let last_message_id = last.message_id.clone();
        span.record("read", page.len());
        span.record("last_message_id", last_message_id.as_str());

        let on_replica = self
            .replica
            .existing_messages(&message_ids(page.iter()))
            .await
            .map_err(source_failed)?;
        let candidates: Vec<&IndexedChatMessage> = page
            .iter()
            .filter(|message| !on_replica.contains(&message.message_id))
            .collect();
        let gone: Vec<IndexedChatMessage> = if candidates.is_empty() {
            Vec::new()
        } else {
            let on_primary = self
                .primary
                .existing_messages(&message_ids(candidates.iter().copied()))
                .await
                .map_err(source_failed)?;
            candidates
                .into_iter()
                .filter(|message| !on_primary.contains(&message.message_id))
                .cloned()
                .collect()
        };
        span.record("gone", gone.len());

        if !gone.is_empty() {
            let chat_ids: Vec<String> = gone
                .iter()
                .map(|message| message.chat_id.clone())
                .collect::<HashSet<_>>()
                .into_iter()
                .collect();
            // Only the span and the log read this, so replica lag is harmless
            // and a failed lookup leaves it unset instead of stopping the page.
            let gone_with_chat = match self.replica.existing_chats(&chat_ids).await {
                Ok(chats) => Some(
                    gone.iter()
                        .filter(|message| !chats.contains(&message.chat_id))
                        .count(),
                ),
                Err(error) => {
                    tracing::warn!(error = ?error, "could not look up the chats of gone messages");
                    None
                }
            };
            let sample = gone_sample(&gone);
            span.record("gone_sample", sample.as_str());
            if let Some(gone_with_chat) = gone_with_chat {
                span.record("gone_with_chat", gone_with_chat);
            }
            // Traces keep few of these pages, so the sample is also logged, to
            // check a dry run's finds against `ChatMessage` from the logs.
            tracing::info!(
                job_id = job_id.map(tracing::field::display),
                dry_run,
                gone = gone.len(),
                gone_with_chat,
                gone_sample = sample.as_str(),
                "chat message repair page found messages whose row is gone"
            );
        }

        let delete = if dry_run || gone.is_empty() {
            MessageDelete::default()
        } else {
            match self.index.delete(&gone).await {
                Ok(delete) => delete,
                Err(MessageIndexError::Refused(reason)) => {
                    span.record("outcome", "refused");
                    return Err(BackfillError::Stopped {
                        reason,
                        cursor: after_message_id.map(str::to_owned),
                    });
                }
                Err(MessageIndexError::ItemsFailed(reason)) => {
                    span.record("outcome", "items_failed");
                    return Err(BackfillError::Stopped {
                        reason,
                        cursor: after_message_id.map(str::to_owned),
                    });
                }
                Err(MessageIndexError::Internal(e)) => {
                    span.record("outcome", "index_failed");
                    return Err(BackfillError::Index(anyhow::anyhow!("{e:#}")));
                }
            }
        };
        span.record("deleted", delete.deleted);
        span.record("not_found", delete.not_found);
        span.record("outcome", "finished");

        Ok(Some(FinishedPage {
            last_message_id,
            read: page.len(),
            gone: gone.len(),
            delete,
        }))
    }
}

/// How many of a page's gone messages its span names, so a dry run's finds can
/// be checked against the database by hand.
const GONE_SAMPLE: usize = 10;

/// Up to [`GONE_SAMPLE`] gone messages, as `chat_id:message_id` (their document
/// ids), comma separated.
fn gone_sample(gone: &[IndexedChatMessage]) -> String {
    gone.iter()
        .take(GONE_SAMPLE)
        .map(|message| format!("{}:{}", message.chat_id, message.message_id))
        .collect::<Vec<_>>()
        .join(",")
}

fn message_ids<'a>(messages: impl Iterator<Item = &'a IndexedChatMessage>) -> Vec<String> {
    messages.map(|message| message.message_id.clone()).collect()
}

/// How long a page that read `messages` must take to keep to
/// `messages_per_second`.
fn page_budget(messages: usize, messages_per_second: NonZeroU32) -> Duration {
    let messages = u32::try_from(messages).unwrap_or(u32::MAX);
    Duration::from_secs(1).saturating_mul(messages) / messages_per_second.get()
}
