//! Domain service for backfilling markdown content lifecycle from sync-service state.

use std::{future::Future, time::Duration};

use anyhow::Context;
use futures::stream::{self, StreamExt};
use tokio::time::{sleep, timeout};

use crate::domain::models::DocumentError;
use crate::domain::ports::markdown::MarkdownInitializationPort;

/// Runtime options for markdown lifecycle backfill.
#[derive(Clone, Debug)]
pub struct MarkdownBackfillOptions {
    /// Persist DB lifecycle updates when true. Dry-run when false.
    pub apply: bool,
    /// Number of candidates to fetch per DB page.
    pub batch_size: i64,
    /// Maximum concurrent per-document sync/S3/init checks per batch.
    pub concurrency: usize,
    /// Number of retries after the first sync-service exists attempt.
    pub exists_retries: usize,
    /// Per-attempt sync-service exists timeout.
    pub exists_timeout: Duration,
    /// Optional maximum number of candidates to scan.
    pub limit: Option<usize>,
    /// Optional exclusive document-id cursor.
    pub start_after: Option<String>,
    /// Initialize missing sync-service documents from object storage.
    pub initialize_missing: bool,
}

/// One markdown document candidate for lifecycle backfill.
#[derive(Clone, Debug)]
pub struct MarkdownBackfillCandidate {
    /// Document id.
    pub id: String,
    /// Document owner user id.
    pub owner: String,
    /// Latest document instance id containing object-storage markdown bytes.
    pub document_instance_id: Option<i64>,
    /// Legacy uploaded flag.
    pub uploaded: bool,
    /// Current persisted content state.
    pub content_state: String,
    /// Current persisted content location.
    pub content_location: Option<String>,
}

/// Fetch and update markdown lifecycle metadata.
pub trait MarkdownBackfillRepo: Send + Sync {
    /// Fetch a page of markdown candidates not already `ready / sync_service`.
    fn fetch_markdown_backfill_candidates(
        &self,
        start_after: Option<&str>,
        limit: i64,
    ) -> impl Future<Output = anyhow::Result<Vec<MarkdownBackfillCandidate>>> + Send;

    /// Mark inspected candidate documents as `ready / sync_service` in one
    /// batch update. Implementations should use optimistic guards so rows are
    /// updated only if the latest document instance and lifecycle still match
    /// the inspected candidate values.
    fn mark_markdown_sync_service_ready(
        &self,
        candidates: &[MarkdownBackfillCandidate],
    ) -> impl Future<Output = anyhow::Result<u64>> + Send;
}

/// Checks sync-service document existence.
pub trait SyncServiceProbe: Send + Sync {
    /// Return true if sync-service already has the document.
    fn exists(&self, document_id: &str) -> impl Future<Output = anyhow::Result<bool>> + Send;
}

/// Reads original markdown content from object storage.
pub trait MarkdownObjectReader: Send + Sync {
    /// Read UTF-8 markdown content for a candidate.
    fn read_markdown(
        &self,
        candidate: &MarkdownBackfillCandidate,
    ) -> impl Future<Output = Result<String, MarkdownObjectReadError>> + Send;
}

/// Object-storage markdown read failure.
#[derive(Clone, Debug, thiserror::Error)]
pub enum MarkdownObjectReadError {
    /// The expected object-storage key does not exist.
    #[error("markdown object missing: {key}")]
    Missing {
        /// Expected S3 key.
        key: String,
    },
    /// Object read failed for reasons other than missing key.
    #[error("failed to read markdown object {key}: {error}")]
    Read {
        /// Expected S3 key.
        key: String,
        /// Read error details.
        error: String,
    },
    /// Object bytes were not valid UTF-8.
    #[error("markdown object {key} is not valid UTF-8: {error}")]
    InvalidUtf8 {
        /// Expected S3 key.
        key: String,
        /// UTF-8 decode error details.
        error: String,
    },
}

/// Accumulated markdown backfill counters.
#[derive(Clone, Debug, Default)]
pub struct MarkdownBackfillStats {
    /// Number of candidate rows scanned.
    pub scanned: usize,
    /// Number of scanned documents that already existed in sync-service.
    pub sync_exists: usize,
    /// Number of scanned documents missing from sync-service.
    pub sync_missing: usize,
    /// Dry-run count that would be marked ready because sync-service exists.
    pub would_update: usize,
    /// DB rows updated in apply mode.
    pub updated: usize,
    /// Dry-run count that would be initialized from object storage.
    pub would_initialize: usize,
    /// Apply count successfully initialized in sync-service.
    pub initialized: usize,
    /// Missing original markdown object count.
    pub object_missing: usize,
    /// Failed object read count.
    pub object_read_errors: usize,
    /// Invalid UTF-8 object count.
    pub invalid_utf8: usize,
    /// Failed sync-service initialization count.
    pub initialize_errors: usize,
    /// Missing document instance id count.
    pub missing_document_instance: usize,
    /// Sync-service exists check error count.
    pub sync_errors: usize,
}

impl MarkdownBackfillStats {
    fn add(&mut self, other: &Self) {
        self.scanned += other.scanned;
        self.sync_exists += other.sync_exists;
        self.sync_missing += other.sync_missing;
        self.would_update += other.would_update;
        self.updated += other.updated;
        self.would_initialize += other.would_initialize;
        self.initialized += other.initialized;
        self.object_missing += other.object_missing;
        self.object_read_errors += other.object_read_errors;
        self.invalid_utf8 += other.invalid_utf8;
        self.initialize_errors += other.initialize_errors;
        self.missing_document_instance += other.missing_document_instance;
        self.sync_errors += other.sync_errors;
    }
}

/// Final report returned by the backfill service.
#[derive(Clone, Debug)]
pub struct MarkdownBackfillReport {
    /// Aggregate counters.
    pub stats: MarkdownBackfillStats,
    /// Last scanned document id, usable with `start_after`.
    pub last_id: Option<String>,
}

/// Backfill service composed from hexagonal ports.
#[derive(Clone)]
pub struct MarkdownBackfillService<R, S, O, M> {
    repo: R,
    sync_service: S,
    object_reader: O,
    markdown_initializer: M,
}

impl<R, S, O, M> MarkdownBackfillService<R, S, O, M> {
    /// Construct a markdown backfill service.
    pub fn new(repo: R, sync_service: S, object_reader: O, markdown_initializer: M) -> Self {
        Self {
            repo,
            sync_service,
            object_reader,
            markdown_initializer,
        }
    }
}

impl<R, S, O, M> MarkdownBackfillService<R, S, O, M>
where
    R: MarkdownBackfillRepo + Clone,
    S: SyncServiceProbe + Clone,
    O: MarkdownObjectReader + Clone,
    M: MarkdownInitializationPort + Clone,
{
    /// Run the backfill until no candidates remain or `options.limit` is reached.
    pub async fn run(
        &self,
        options: MarkdownBackfillOptions,
    ) -> anyhow::Result<MarkdownBackfillReport> {
        let mut stats = MarkdownBackfillStats::default();
        let mut last_id = options.start_after.clone();

        loop {
            if options.limit.is_some_and(|limit| stats.scanned >= limit) {
                break;
            }

            let remaining_limit = options
                .limit
                .map(|limit| limit.saturating_sub(stats.scanned) as i64)
                .unwrap_or(options.batch_size);
            let batch_limit = options.batch_size.min(remaining_limit);
            if batch_limit == 0 {
                break;
            }

            let rows = self
                .repo
                .fetch_markdown_backfill_candidates(last_id.as_deref(), batch_limit)
                .await?;
            if rows.is_empty() {
                break;
            }

            tracing::info!(
                batch_len = rows.len(),
                batch_limit,
                "fetched markdown candidate batch"
            );

            last_id = rows.last().map(|row| row.id.clone());

            let outcomes = stream::iter(rows)
                .map(|candidate| {
                    let service = self.clone();
                    let options = options.clone();
                    async move { service.process_candidate(candidate, &options).await }
                })
                .buffer_unordered(options.concurrency)
                .collect::<Vec<_>>()
                .await;

            let mut batch_stats = MarkdownBackfillStats::default();
            let mut ready_candidates = Vec::new();
            for outcome in outcomes {
                record_outcome(outcome, &mut batch_stats, &mut ready_candidates);
            }

            if options.apply && !ready_candidates.is_empty() {
                batch_stats.updated = self
                    .repo
                    .mark_markdown_sync_service_ready(&ready_candidates)
                    .await? as usize;
            }

            stats.add(&batch_stats);

            tracing::info!(
                scanned = batch_stats.scanned,
                sync_exists = batch_stats.sync_exists,
                sync_missing = batch_stats.sync_missing,
                would_update = batch_stats.would_update,
                updated = batch_stats.updated,
                would_initialize = batch_stats.would_initialize,
                initialized = batch_stats.initialized,
                object_missing = batch_stats.object_missing,
                object_read_errors = batch_stats.object_read_errors,
                invalid_utf8 = batch_stats.invalid_utf8,
                initialize_errors = batch_stats.initialize_errors,
                missing_document_instance = batch_stats.missing_document_instance,
                sync_errors = batch_stats.sync_errors,
                total_scanned = stats.scanned,
                last_id = ?last_id,
                "processed markdown candidate batch"
            );
        }

        Ok(MarkdownBackfillReport { stats, last_id })
    }

    async fn process_candidate(
        &self,
        candidate: MarkdownBackfillCandidate,
        options: &MarkdownBackfillOptions,
    ) -> CandidateOutcome {
        let result = match sync_exists_with_retries(
            &self.sync_service,
            &candidate.id,
            options.exists_retries,
            options.exists_timeout,
        )
        .await
        {
            Ok(true) if options.apply => CandidateResult::SyncExists,
            Ok(true) => CandidateResult::WouldUpdate,
            Ok(false) if options.initialize_missing => {
                self.initialize_missing_markdown(&candidate, options.apply)
                    .await
            }
            Ok(false) => CandidateResult::SyncMissing,
            Err(error) => CandidateResult::SyncError {
                error: format!("{error:?}"),
            },
        };

        CandidateOutcome { candidate, result }
    }

    async fn initialize_missing_markdown(
        &self,
        candidate: &MarkdownBackfillCandidate,
        apply: bool,
    ) -> CandidateResult {
        if candidate.document_instance_id.is_none() {
            return CandidateResult::MissingDocumentInstance;
        }

        let markdown = match self.object_reader.read_markdown(candidate).await {
            Ok(markdown) => markdown,
            Err(MarkdownObjectReadError::Missing { key }) => {
                return CandidateResult::ObjectMissing { key };
            }
            Err(MarkdownObjectReadError::Read { key, error }) => {
                return CandidateResult::ObjectReadError { key, error };
            }
            Err(MarkdownObjectReadError::InvalidUtf8 { key, error }) => {
                return CandidateResult::InvalidUtf8 { key, error };
            }
        };

        if !apply {
            return CandidateResult::WouldInitialize;
        }

        match self
            .markdown_initializer
            .initialize_existing_markdown(&candidate.id, &markdown)
            .await
        {
            Ok(()) => CandidateResult::Initialized,
            Err(error) if sync_snapshot_already_exists(&error) => CandidateResult::Initialized,
            Err(error) => CandidateResult::InitializeError {
                error: error.to_string(),
            },
        }
    }
}

#[derive(Debug)]
enum CandidateResult {
    WouldUpdate,
    SyncExists,
    SyncMissing,
    WouldInitialize,
    Initialized,
    ObjectMissing { key: String },
    ObjectReadError { key: String, error: String },
    InvalidUtf8 { key: String, error: String },
    InitializeError { error: String },
    MissingDocumentInstance,
    SyncError { error: String },
}

#[derive(Debug)]
struct CandidateOutcome {
    candidate: MarkdownBackfillCandidate,
    result: CandidateResult,
}

fn record_outcome(
    outcome: CandidateOutcome,
    stats: &mut MarkdownBackfillStats,
    ready_candidates: &mut Vec<MarkdownBackfillCandidate>,
) {
    stats.scanned += 1;
    let candidate = outcome.candidate;

    match outcome.result {
        CandidateResult::WouldUpdate => {
            stats.sync_exists += 1;
            stats.would_update += 1;
            tracing::debug!(document_id = %candidate.id, "markdown document exists in sync-service; would mark ready/sync_service");
        }
        CandidateResult::SyncExists => {
            stats.sync_exists += 1;
            ready_candidates.push(candidate.clone());
            tracing::debug!(document_id = %candidate.id, "markdown document exists in sync-service; will mark ready/sync_service");
        }
        CandidateResult::SyncMissing => {
            stats.sync_missing += 1;
            tracing::debug!(document_id = %candidate.id, "markdown document does not exist in sync-service; leaving lifecycle unchanged");
        }
        CandidateResult::WouldInitialize => {
            stats.sync_missing += 1;
            stats.would_initialize += 1;
            tracing::debug!(document_id = %candidate.id, "markdown document does not exist in sync-service; would initialize from object storage");
        }
        CandidateResult::Initialized => {
            stats.sync_missing += 1;
            stats.initialized += 1;
            ready_candidates.push(candidate.clone());
            tracing::debug!(document_id = %candidate.id, "markdown document initialized in sync-service; will mark ready/sync_service");
        }
        CandidateResult::ObjectMissing { key } => {
            stats.sync_missing += 1;
            stats.object_missing += 1;
            tracing::debug!(document_id = %candidate.id, s3_key = %key, "markdown source object missing; leaving lifecycle unchanged");
        }
        CandidateResult::ObjectReadError { key, error } => {
            stats.sync_missing += 1;
            stats.object_read_errors += 1;
            tracing::warn!(document_id = %candidate.id, s3_key = %key, error = %error, "failed to read markdown object; leaving lifecycle unchanged");
        }
        CandidateResult::InvalidUtf8 { key, error } => {
            stats.sync_missing += 1;
            stats.invalid_utf8 += 1;
            tracing::warn!(document_id = %candidate.id, s3_key = %key, error = %error, "markdown source object is not valid UTF-8; leaving lifecycle unchanged");
        }
        CandidateResult::InitializeError { error } => {
            stats.sync_missing += 1;
            stats.initialize_errors += 1;
            tracing::warn!(document_id = %candidate.id, error = %error, "failed to initialize markdown in sync-service; leaving lifecycle unchanged");
        }
        CandidateResult::MissingDocumentInstance => {
            stats.sync_missing += 1;
            stats.missing_document_instance += 1;
            tracing::debug!(document_id = %candidate.id, "markdown document has no document instance; leaving lifecycle unchanged");
        }
        CandidateResult::SyncError { error } => {
            stats.sync_errors += 1;
            tracing::warn!(document_id = %candidate.id, error = %error, "failed to query sync-service; leaving lifecycle unchanged");
        }
    }
}

async fn sync_exists_with_retries<S>(
    sync_service: &S,
    document_id: &str,
    retries: usize,
    request_timeout: Duration,
) -> anyhow::Result<bool>
where
    S: SyncServiceProbe,
{
    let attempts = retries + 1;

    for attempt_index in 0..attempts {
        let attempt = attempt_index + 1;

        match timeout(request_timeout, sync_service.exists(document_id)).await {
            Ok(Ok(exists)) => return Ok(exists),
            Ok(Err(error)) if attempt < attempts => {
                tracing::debug!(%document_id, attempt, attempts, error = ?error, "sync-service exists request failed; retrying");
            }
            Ok(Err(error)) => {
                return Err(error).with_context(|| {
                    format!("sync-service exists request failed after {attempts} attempts")
                });
            }
            Err(error) if attempt < attempts => {
                tracing::debug!(%document_id, attempt, attempts, timeout_secs = request_timeout.as_secs(), error = ?error, "sync-service exists request timed out; retrying");
            }
            Err(error) => {
                return Err(error).with_context(|| {
                    format!(
                        "sync-service exists request timed out after {attempts} attempts of {}s",
                        request_timeout.as_secs()
                    )
                });
            }
        }

        sleep(Duration::from_millis(250 * attempt as u64)).await;
    }

    unreachable!("retry loop should return before exhausting attempts")
}

fn sync_snapshot_already_exists(error: &DocumentError) -> bool {
    error.to_string().contains("snapshot already exists")
}
