//! Backfill of `is_email_attachment` onto the documents search index.
//!
//! Full index writes carry the flag, so this covers documents indexed before
//! it existed. The job walks every document linked to an email attachment in
//! `document_id` order and sets the flag on each live one's indexed parent
//! with partial updates, at a bounded rate. It records its cursor after every
//! page so a stopped job can resume, and it stops, without retrying, when the
//! search index refuses writes.

use super::backfill_gate::BackfillGate;
use std::{num::NonZeroU32, sync::Arc, time::Duration};

use rootcause::Report;
use serde::Deserialize;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;
use tracing::field::Empty;

use super::{
    jobs::{JobId, JobProgress, PageProgress},
    models::{BackfillError, BackfillReceipt},
};

#[cfg(test)]
mod test;

/// Documents read per page when the request names none.
const DEFAULT_PAGE_SIZE: u16 = 500;

/// Largest page a request may ask for; each page is one `_bulk` request.
const MAX_PAGE_SIZE: u16 = 1000;

/// Updates per second when the request names no rate. Low because earlier
/// backfills drove the production cluster into its flood-stage write block.
const DEFAULT_DOCS_PER_SECOND: NonZeroU32 = NonZeroU32::new(100).expect("100 is not zero");

/// Rows read per page, from 1 to 1000: distinct linked documents for the
/// email attachment status backfill, indexed messages for the chat message
/// repair.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(try_from = "u16")]
pub struct PageSize(u16);

impl PageSize {
    pub fn get(self) -> u16 {
        self.0
    }
}

impl Default for PageSize {
    fn default() -> Self {
        Self(DEFAULT_PAGE_SIZE)
    }
}

/// A page size outside 1 to [`MAX_PAGE_SIZE`].
#[derive(Debug, thiserror::Error)]
#[error("page_size must be between 1 and {MAX_PAGE_SIZE}")]
pub struct PageSizeOutOfRange;

impl TryFrom<u16> for PageSize {
    type Error = PageSizeOutOfRange;

    fn try_from(value: u16) -> Result<Self, Self::Error> {
        if (1..=MAX_PAGE_SIZE).contains(&value) {
            Ok(Self(value))
        } else {
            Err(PageSizeOutOfRange)
        }
    }
}

/// Body of `POST /internal/backfill/email-attachment-status`.
#[derive(Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct EmailAttachmentStatusBackfillRequest {
    /// Start after this document id: the `cursor` of a stopped or failed job.
    pub after_document_id: Option<String>,
    /// Distinct linked documents per page; 500 when omitted.
    pub page_size: Option<PageSize>,
    /// Most documents updated per second; 100 when omitted.
    pub docs_per_second: Option<NonZeroU32>,
}

/// A document linked to an email attachment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkedDocument {
    pub document_id: String,
    /// The document exists and is not trashed. Only live documents are
    /// updated; trashing a document removes it from the index.
    pub is_live: bool,
}

/// Reads the documents linked to email attachments.
pub trait LinkedDocumentSource: Send + Sync + 'static {
    /// Up to `limit` distinct linked documents after `after_document_id` (or
    /// from the start), in `document_id` order. Empty once past the last one.
    fn page_after(
        &self,
        after_document_id: Option<&str>,
        limit: PageSize,
    ) -> impl Future<Output = Result<Vec<LinkedDocument>, Report>> + Send;
}

/// What one batch of flag updates changed.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct FlagUpdate {
    /// Parents that now carry the flag.
    pub updated: usize,
    /// Documents with no parent in the index; their first full index writes
    /// the flag.
    pub missing: usize,
    /// Documents the index failed to update.
    pub failed: usize,
}

/// Why the index did not apply a batch of flag updates.
#[derive(Debug, thiserror::Error)]
pub enum FlagIndexError {
    /// The index refused writes to protect itself (a 429 or a cluster block).
    /// Sending more makes it worse, so the job stops.
    #[error("{0}")]
    Refused(String),
    #[error("{0:?}")]
    Internal(Report),
}

/// Writes `is_email_attachment` onto indexed documents.
pub trait EmailAttachmentFlagIndex: Send + Sync + 'static {
    fn set_email_attachment(
        &self,
        document_ids: &[String],
        is_email_attachment: bool,
    ) -> impl Future<Output = Result<FlagUpdate, FlagIndexError>> + Send;
}

/// A page the job finished.
struct FinishedPage {
    /// The last document the page read, live or not; the next page starts
    /// after it.
    last_document_id: String,
    /// Distinct linked documents the page read.
    read: usize,
    /// Live documents sent to the index.
    sent: usize,
    update: FlagUpdate,
}

/// How long a page that sent `documents` updates must take to keep to
/// `docs_per_second`.
fn page_budget(documents: usize, docs_per_second: NonZeroU32) -> Duration {
    let documents = u32::try_from(documents).unwrap_or(u32::MAX);
    Duration::from_secs(1).saturating_mul(documents) / docs_per_second.get()
}

pub struct EmailAttachmentStatusBackfill<S, I> {
    source: S,
    index: I,
    gate: BackfillGate,
}

impl<S: LinkedDocumentSource, I: EmailAttachmentFlagIndex> EmailAttachmentStatusBackfill<S, I> {
    pub fn new(source: S, index: I, gate: BackfillGate) -> Self {
        Self {
            source,
            index,
            gate,
        }
    }

    /// Set the flag on every live linked document, page by page, until the
    /// walk ends, the job is cancelled, or the index refuses writes.
    /// Cancellation is checked between pages and ends a page's pause early.
    pub async fn backfill(
        &self,
        req: EmailAttachmentStatusBackfillRequest,
        progress: Arc<JobProgress>,
        cancel: CancellationToken,
    ) -> Result<BackfillReceipt, BackfillError> {
        let page_size = req.page_size.unwrap_or_default();
        let docs_per_second = req.docs_per_second.unwrap_or(DEFAULT_DOCS_PER_SECOND);
        let mut after_document_id = req.after_document_id;
        let mut read = 0;

        while !cancel.is_cancelled() {
            let permit = tokio::select! {
                biased;
                () = cancel.cancelled() => break,
                permit = self.gate.admit() => permit,
            };
            let started = Instant::now();
            let Some(page) = self
                .backfill_page(after_document_id.as_deref(), page_size, progress.job_id())
                .await?
            else {
                break;
            };
            drop(permit);

            progress
                .record_page(PageProgress {
                    cursor: &page.last_document_id,
                    processed: page.read,
                    updated: page.update.updated,
                    missing: page.update.missing,
                    failed: page.update.failed,
                })
                .await;
            read += page.read;
            after_document_id = Some(page.last_document_id);

            let resume_at = started + page_budget(page.sent, docs_per_second);
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

    /// Read one page and set the flag on its live documents. `None` once the
    /// walk is past the last linked document.
    #[tracing::instrument(
        name = "search.email_attachment_status.page",
        skip_all,
        fields(
            job_id = job_id.map(tracing::field::display),
            after_document_id,
            page_size = page_size.get(),
            read = Empty,
            sent = Empty,
            updated = Empty,
            missing = Empty,
            failed = Empty,
            last_document_id = Empty,
            outcome = Empty,
        ),
        err(Debug)
    )]
    async fn backfill_page(
        &self,
        after_document_id: Option<&str>,
        page_size: PageSize,
        job_id: Option<&JobId>,
    ) -> Result<Option<FinishedPage>, BackfillError> {
        let span = tracing::Span::current();

        let documents = self
            .source
            .page_after(after_document_id, page_size)
            .await
            .map_err(|e| {
                span.record("outcome", "source_failed");
                BackfillError::Source(anyhow::anyhow!("{e:#}"))
            })?;
        let Some(last) = documents.last() else {
            span.record("outcome", "exhausted");
            return Ok(None);
        };
        let last_document_id = last.document_id.clone();

        let live: Vec<String> = documents
            .iter()
            .filter(|document| document.is_live)
            .map(|document| document.document_id.clone())
            .collect();
        span.record("read", documents.len());
        span.record("sent", live.len());
        span.record("last_document_id", last_document_id.as_str());

        let update = if live.is_empty() {
            FlagUpdate::default()
        } else {
            match self.index.set_email_attachment(&live, true).await {
                Ok(update) => update,
                Err(FlagIndexError::Refused(reason)) => {
                    span.record("outcome", "refused");
                    return Err(BackfillError::Stopped {
                        reason,
                        cursor: after_document_id.map(str::to_owned),
                    });
                }
                Err(FlagIndexError::Internal(e)) => {
                    span.record("outcome", "index_failed");
                    return Err(BackfillError::Index(anyhow::anyhow!("{e:#}")));
                }
            }
        };
        span.record("updated", update.updated);
        span.record("missing", update.missing);
        span.record("failed", update.failed);
        if update.failed > 0 {
            // Stop before the cursor moves past them, so a resume repeats the
            // page; the update is idempotent.
            span.record("outcome", "items_failed");
            return Err(BackfillError::Stopped {
                reason: format!("{} documents failed to update", update.failed),
                cursor: after_document_id.map(str::to_owned),
            });
        }
        span.record("outcome", "finished");

        Ok(Some(FinishedPage {
            last_document_id,
            read: documents.len(),
            sent: live.len(),
            update,
        }))
    }
}
