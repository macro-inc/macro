//! Email attachments whose mail is gone go to the Trash.
//!
//! An email attachment's Drive document is marked as one only by its
//! `document_email` link, which is deleted with its message, thread or inbox.
//! A statement that removes a live document's links records the document in
//! `released_email_attachment_documents` (migration `20261116200143`), and
//! [`ReleasedAttachmentService::drain`] works through that queue in batches.
//!
//! Each claimed document is checked again when its batch runs. One with a link
//! left is skipped; one with none is trashed unless it is already in the Trash
//! or its owner adopted it, in which case it is kept as it is. Every claimed
//! row leaves the queue either way.
//!
//! Documents that lost their links before the queue existed are found and
//! queued by [`orphans`].
//!
//! A batch writes what a document's own trash writes and publishes one
//! [`EmailAttachmentsReleased`](super::events::DocumentTopicEvent::EmailAttachmentsReleased)
//! event naming its trashed and kept documents, none of which is an email
//! attachment any more. As a folder's trash does for the documents in it, open
//! lists drop the trashed ones and nothing else reacts per document.

use super::events::{DocumentMacroEvent, EmailAttachmentsReleasedMetadata};
use macro_event_broker::MacroEventBroker;
use std::future::Future;

pub mod orphans;
#[cfg(test)]
mod test;

/// Released documents claimed and settled in one transaction, as many as one
/// mailbox purge batch releases.
pub const RELEASE_BATCH_SIZE: u32 = 500;

/// What one batch did with the documents it claimed.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ReleasedBatch {
    /// Queue rows claimed and removed.
    pub claimed: usize,
    /// Documents moved to the Trash.
    pub trashed: Vec<String>,
    /// Documents left without a link as they were: adopted by their owner, or
    /// already in the Trash.
    pub kept: Vec<String>,
    /// How many of `kept` their owner moved into a folder, shared, edited or
    /// commented on; the rest were already in the Trash.
    pub adopted: usize,
    /// Still linked to other mail, or linked again by a re-import.
    pub relinked: usize,
    /// Already gone.
    pub missing: usize,
}

/// How far behind the queue is.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ReleaseQueue {
    /// Rows waiting, counted up to [`QUEUE_DEPTH_CAP`].
    pub depth: i64,
    /// Seconds the oldest waiting row has waited.
    pub oldest_age_seconds: Option<i64>,
}

/// Batches one drain runs at most. A backlog then waits for the next round
/// (a notification, or the host's sweep) instead of being trashed as fast as
/// the database allows, and each round stays one bounded trace.
pub const DRAIN_BATCH_LIMIT: usize = 20;

/// The queue depth is counted up to this many rows, so reading it stays cheap
/// while a large backlog drains.
pub const QUEUE_DEPTH_CAP: i64 = 100_000;

/// Storage for the released-attachment queue and the trash it applies.
pub trait ReleasedAttachmentRepo: Send + Sync + 'static {
    /// Storage failure.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Claim up to `limit` queued documents and trash the ones that qualify,
    /// in one transaction.
    fn trash_released_batch(
        &self,
        limit: u32,
    ) -> impl Future<Output = Result<ReleasedBatch, Self::Err>> + Send;

    /// The queue's depth and the age of its oldest row.
    fn queue(&self) -> impl Future<Output = Result<ReleaseQueue, Self::Err>> + Send;
}

/// Drains the released-attachment queue.
pub struct ReleasedAttachmentService<R, B> {
    repo: R,
    broker: B,
}

impl<R: ReleasedAttachmentRepo, B: MacroEventBroker> ReleasedAttachmentService<R, B> {
    /// Build the service over its queue storage and the event broker.
    pub fn new(repo: R, broker: B) -> Self {
        Self { repo, broker }
    }

    /// Trash released documents batch by batch until the queue is empty or
    /// [`DRAIN_BATCH_LIMIT`] batches ran. Returns how many were trashed.
    #[tracing::instrument(
        name = "document.released_attachments.drain",
        skip_all,
        fields(
            queue.depth = tracing::field::Empty,
            queue.oldest_age_seconds = tracing::field::Empty,
            batches = tracing::field::Empty,
            trashed = tracing::field::Empty,
            limited = tracing::field::Empty,
        ),
        err
    )]
    pub async fn drain(&self) -> Result<usize, rootcause::Report> {
        let queue = self
            .repo
            .queue()
            .await
            .map_err(|error| rootcause::Report::new(error).into_dynamic())?;
        let span = tracing::Span::current();
        span.record("queue.depth", queue.depth);
        if let Some(age) = queue.oldest_age_seconds {
            span.record("queue.oldest_age_seconds", age);
        }

        let mut batches = 0usize;
        let mut trashed = 0usize;
        let mut limited = true;
        let mut outcome = Ok(());
        while batches < DRAIN_BATCH_LIMIT {
            match self.trash_batch().await {
                Ok(batch) if batch.claimed == 0 => {
                    limited = false;
                    break;
                }
                Ok(batch) => {
                    batches += 1;
                    trashed += batch.trashed.len();
                }
                Err(error) => {
                    limited = false;
                    outcome = Err(error);
                    break;
                }
            }
        }
        span.record("batches", batches);
        span.record("trashed", trashed);
        span.record("limited", limited);

        outcome.map(|()| trashed)
    }

    #[tracing::instrument(
        name = "document.released_attachments.batch",
        skip_all,
        fields(
            claimed = tracing::field::Empty,
            trashed = tracing::field::Empty,
            kept = tracing::field::Empty,
            skipped.relinked = tracing::field::Empty,
            skipped.missing = tracing::field::Empty,
            skipped.adopted = tracing::field::Empty,
            skipped.in_trash = tracing::field::Empty,
            event.published = tracing::field::Empty,
        ),
        err
    )]
    async fn trash_batch(&self) -> Result<ReleasedBatch, rootcause::Report> {
        let batch = self
            .repo
            .trash_released_batch(RELEASE_BATCH_SIZE)
            .await
            .map_err(|error| rootcause::Report::new(error).into_dynamic())?;
        let span = tracing::Span::current();
        span.record("claimed", batch.claimed);
        span.record("trashed", batch.trashed.len());
        span.record("skipped.relinked", batch.relinked);
        span.record("skipped.missing", batch.missing);
        span.record("kept", batch.kept.len());
        span.record("skipped.adopted", batch.adopted);
        span.record(
            "skipped.in_trash",
            batch.kept.len().saturating_sub(batch.adopted),
        );

        let published = match batch.trashed.first().or(batch.kept.first()) {
            Some(first) => {
                let event = DocumentMacroEvent::email_attachments_released(
                    first.clone(),
                    EmailAttachmentsReleasedMetadata {
                        trashed_document_ids: batch.trashed.clone(),
                        kept_document_ids: batch.kept.clone(),
                    },
                );
                // The batch is committed; a lost event leaves open lists stale
                // until they refresh, as for any other failed publish.
                self.broker
                    .send_event(&event)
                    .inspect_err(|error| {
                        tracing::error!(error = ?error, "failed to publish email attachments released event");
                    })
                    .is_ok()
            }
            None => false,
        };
        span.record("event.published", published);

        Ok(batch)
    }
}
