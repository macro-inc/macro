//! Durable mailbox enumeration independent from provider-specific notifications.

use email_api_client_core::models::{
    EmailApiError, MailFolder, MailboxChangePage, MailboxMessage, ProviderId, StreamPosition,
    StreamToken,
};
use progress::{ImportCompleted, ImportTally};
use std::future::Future;
use std::time::Instant;
use telemetry::{
    claim_failed, elapsed_ms, record_abandoned, record_deferred, record_done, record_failed,
    span_int,
};
use tracing::{Instrument, Span};
use uuid::Uuid;

pub mod catalog;
pub mod commands;
pub mod contacts;
pub mod credentials;
pub mod drafts;
pub mod gmail_history;
pub mod health;
pub mod initialization;
pub mod lifecycle;
pub mod progress;
pub mod projection;
pub mod settings;
pub mod telemetry;
#[cfg(test)]
mod test;
pub mod watches;

#[derive(Debug, thiserror::Error)]
pub enum MailboxError {
    #[error("{0}")]
    InvalidInput(&'static str),
    #[error(transparent)]
    Provider(#[from] EmailApiError),
    #[error("mailbox persistence is unavailable")]
    Persistence,
    /// A database call failed; the cause carries no row data.
    #[error("mailbox persistence is unavailable: {0}")]
    Database(DatabaseFailure),
    /// A projection's downstream effect (event publishing, a queue, another
    /// service) failed or is not ready.
    #[error("a mailbox projection effect is unavailable: {0}")]
    Effect(EffectFailure),
    #[error("mailbox generation or worker lease changed")]
    Stale,
    /// The provider no longer reports the message where it was; a later
    /// attempt either finds it or settles that it is gone.
    #[error("mailbox message location has not settled")]
    LocationUnsettled,
    /// The message reads as an invitation, but the provider would not return
    /// its MIME source; a later attempt imports it without calendar parts.
    #[error("the invitation's calendar parts are unavailable")]
    CalendarPartsUnavailable,
}

/// Which projection effect deferred the work (`outlook.effect`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EffectFailure {
    /// A broker, queue or service call failed; the effect logs its error.
    Downstream,
    /// Downloading or storing this attachment failed.
    AttachmentUpload { attachment_id: Uuid },
    /// Another worker still holds this attachment's upload claim. A claim
    /// older than three minutes is taken back on the next attempt.
    AttachmentUploadPending {
        attachment_id: Uuid,
        claim_age_seconds: i64,
    },
}

impl EffectFailure {
    /// The `outlook.effect` span value.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Downstream => "downstream",
            Self::AttachmentUpload { .. } => "attachment_upload",
            Self::AttachmentUploadPending { .. } => "attachment_upload_pending",
        }
    }

    pub fn attachment_id(&self) -> Option<Uuid> {
        match self {
            Self::Downstream => None,
            Self::AttachmentUpload { attachment_id }
            | Self::AttachmentUploadPending { attachment_id, .. } => Some(*attachment_id),
        }
    }
}

impl std::fmt::Display for EffectFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Downstream => f.write_str("downstream call failed"),
            Self::AttachmentUpload { .. } => f.write_str("attachment upload failed"),
            Self::AttachmentUploadPending {
                claim_age_seconds, ..
            } => write!(f, "attachment upload claimed {claim_age_seconds} s ago"),
        }
    }
}

/// What failed underneath a database call. The database's own message is
/// left out because it can quote row data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DatabaseFailure {
    /// The database rejected the statement with this SQLSTATE.
    Sqlstate(String),
    /// No pooled connection became free in time.
    PoolTimedOut,
    /// The connection failed or closed.
    Connection,
    /// A returned value could not be decoded.
    Decode,
    /// Any other driver failure.
    Other,
}

impl std::fmt::Display for DatabaseFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Sqlstate(code) => write!(f, "sqlstate {code}"),
            Self::PoolTimedOut => f.write_str("connection pool timed out"),
            Self::Connection => f.write_str("connection failed"),
            Self::Decode => f.write_str("decode failed"),
            Self::Other => f.write_str("driver error"),
        }
    }
}

/// Both generations are resolved from storage, never selected by the client.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct MailboxKey {
    pub link_id: Uuid,
    pub sync_generation: i64,
    pub grant_generation: i64,
}

#[derive(Debug)]
pub struct StreamLease {
    pub id: Uuid,
    pub mailbox: MailboxKey,
    pub folder: ProviderId,
    pub position: Option<StreamToken>,
    pub initial_complete: bool,
    pub lease_id: Uuid,
    pub fence: i64,
    /// The stream's pending notification: the newest one that no delta
    /// checkpoint has read past yet, so a deferred or multi-page read keeps
    /// carrying it.
    pub notification: Option<Notification>,
}

/// A Graph change notification that made sync work due.
#[derive(Debug, Clone)]
pub struct Notification {
    /// When the webhook delivery was accepted.
    pub received_at: chrono::DateTime<chrono::Utc>,
    /// The webhook request's W3C trace context, on the first claim only;
    /// that attempt joins the webhook's trace.
    pub traceparent: Option<String>,
}

#[derive(Debug)]
pub struct MessageLease {
    pub mailbox: MailboxKey,
    pub provider_id: ProviderId,
    pub revision: i64,
    pub lease_id: Uuid,
    pub is_import: bool,
    pub attempts: i32,
    /// The newest change notification that queued this message.
    pub notification: Option<Notification>,
}

#[derive(Debug)]
pub struct CatalogLease {
    pub id: Uuid,
    pub mailbox: MailboxKey,
    pub lease_id: Uuid,
    pub fence: i64,
}

/// What a committed page changed.
#[derive(Debug, Default)]
pub struct CommittedPage {
    /// Reconciliation rows the page queued or requeued.
    pub queued: u64,
    /// Set when this page finished the mailbox's import run.
    pub import_completed: Option<ImportCompleted>,
}

pub enum SyncLease<'a> {
    Catalog(&'a CatalogLease),
    Stream(&'a StreamLease),
    Message(&'a MessageLease),
}

pub trait MailboxSyncRepository: Send + Sync + 'static {
    /// Extend only a still-current lease while a provider operation is in flight.
    fn renew(&self, lease: SyncLease<'_>) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn claim_catalog(
        &self,
        lease_id: Uuid,
    ) -> impl Future<Output = Result<Option<CatalogLease>, MailboxError>> + Send;
    /// Replaces a complete catalog only under its lease fence. Missing folders
    /// trigger message reconciliation, never deletion based on a partial scan.
    fn commit_catalog(
        &self,
        lease: &CatalogLease,
        folders: &[MailFolder],
    ) -> impl Future<Output = Result<Option<ImportCompleted>, MailboxError>> + Send;
    fn release_catalog(
        &self,
        lease: &CatalogLease,
        retry_after_seconds: u32,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn claim_stream(
        &self,
        lease_id: Uuid,
    ) -> impl Future<Output = Result<Option<StreamLease>, MailboxError>> + Send;
    /// Atomically records every changed/removed ID and advances the opaque
    /// cursor only while this generation and lease fence are still current.
    fn commit_page(
        &self,
        lease: &StreamLease,
        page: &MailboxChangePage,
    ) -> impl Future<Output = Result<CommittedPage, MailboxError>> + Send;
    /// Reset only this expired stream; this operation never removes messages.
    fn reset_stream(
        &self,
        lease: &StreamLease,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn release_stream(
        &self,
        lease: &StreamLease,
        retry_after_seconds: u32,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn claim_message(
        &self,
        lease_id: Uuid,
    ) -> impl Future<Output = Result<Option<MessageLease>, MailboxError>> + Send;
    fn folders(
        &self,
        mailbox: MailboxKey,
    ) -> impl Future<Output = Result<Vec<MailFolder>, MailboxError>> + Send;
    /// Finishes only the leased revision. A newer wakeup must remain pending.
    /// Reports the import run this message finished, once per run.
    fn complete_message(
        &self,
        lease: &MessageLease,
    ) -> impl Future<Output = Result<Option<ImportCompleted>, MailboxError>> + Send;
    fn release_message(
        &self,
        lease: &MessageLease,
        retry: MessageRetry,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
}

/// How a message whose reconciliation failed is released.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageRetry {
    /// Claim it again after `seconds`. A mailbox-wide refusal (throttling, no
    /// token) is not `counted`, so it gives the claim back to `attempts`.
    After { seconds: u32, counted: bool },
    /// Stop claiming the leased revision. It stays queued and is counted as
    /// abandoned until a provider change, a resync or a reconnect queues the
    /// message again with fresh attempts.
    Abandon,
}

pub trait MailboxGateway: Send + Sync + 'static {
    fn folders(
        &self,
        mailbox: MailboxKey,
    ) -> impl Future<Output = Result<Vec<MailFolder>, EmailApiError>> + Send;
    fn changes(
        &self,
        mailbox: MailboxKey,
        folder: &ProviderId,
        position: Option<&StreamToken>,
    ) -> impl Future<Output = Result<MailboxChangePage, EmailApiError>> + Send;
    fn message(
        &self,
        mailbox: MailboxKey,
        message: &ProviderId,
        folders: &[MailFolder],
    ) -> impl Future<Output = Result<Option<MailboxMessage>, EmailApiError>> + Send;
    /// Provider requests admitted for the mailbox's sync generation, when known.
    fn admitted_requests(&self, mailbox: MailboxKey) -> impl Future<Output = Option<u64>> + Send;
}

/// The shared ingestion path writes content, normalized state and a projection
/// outbox atomically. Import work must not generate incoming-mail notifications.
pub trait MailboxIngest: Send + Sync + 'static {
    fn ingest(
        &self,
        lease: &MessageLease,
        snapshot: MailboxMessage,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    /// A mailbox-wide GET returned 404. Preserve recoverable content, reconcile
    /// membership, and recheck before any destructive retention decision.
    fn absent(&self, lease: &MessageLease)
    -> impl Future<Output = Result<(), MailboxError>> + Send;
}

pub struct MailboxSyncService<R, P, I> {
    repo: R,
    provider: P,
    ingest: I,
    imports: ImportTally,
}

impl<R, P, I> MailboxSyncService<R, P, I> {
    pub fn new(repo: R, provider: P, ingest: I) -> Self {
        Self {
            repo,
            provider,
            ingest,
            imports: ImportTally::default(),
        }
    }

    /// The in-memory import counts the health loop flushes.
    pub fn import_tally(&self) -> ImportTally {
        self.imports.clone()
    }
}

impl<R: MailboxSyncRepository, P: MailboxGateway, I: MailboxIngest> MailboxSyncService<R, P, I> {
    pub async fn discover_once(&self) -> Result<bool, MailboxError> {
        let Some(lease) = self
            .repo
            .claim_catalog(macro_uuid::generate_uuid_v7())
            .await
            .map_err(|error| claim_failed("discover", error))?
        else {
            return Ok(false);
        };
        let span = tracing::info_span!(
            "outlook.sync.discover",
            mailbox.link_id = %lease.mailbox.link_id,
            mailbox.sync_generation = lease.mailbox.sync_generation,
            outlook.stream_kind = "folder_catalog",
            outlook.folders = tracing::field::Empty,
            outlook.outcome = tracing::field::Empty,
            outlook.defer_reason = tracing::field::Empty,
            outlook.defer_seconds = tracing::field::Empty,
            otel.status_description = tracing::field::Empty,
        );
        self.discover(&lease).instrument(span).await
    }

    async fn discover(&self, lease: &CatalogLease) -> Result<bool, MailboxError> {
        let span = Span::current();
        let outcome = maintain_lease(
            async { Ok(self.provider.folders(lease.mailbox).await?) },
            || self.repo.renew(SyncLease::Catalog(lease)),
        )
        .await;
        let result = match outcome {
            Ok(folders) => {
                span.record("outlook.folders", span_int(folders.len()));
                self.repo.commit_catalog(lease, &folders).await
            }
            Err(MailboxError::Provider(error)) => {
                let delay = retry_seconds(&error);
                let error = MailboxError::from(error);
                self.repo
                    .release_catalog(lease, delay)
                    .await
                    .inspect_err(|release| {
                        record_failed(&span, lease.mailbox.link_id, release);
                    })?;
                record_deferred(&span, lease.mailbox.link_id, &error, delay);
                return Err(error);
            }
            Err(error) => Err(error),
        };
        match result {
            Ok(import_completed) => {
                record_done(&span, "imported");
                if let Some(completed) = import_completed {
                    self.report_import_completed(&completed).await;
                }
                Ok(true)
            }
            Err(error) => {
                record_failed(&span, lease.mailbox.link_id, &error);
                Err(error)
            }
        }
    }

    /// Process one bounded provider page. Notifications only make streams due;
    /// periodic polling recovers missed, duplicate and out-of-order notifications.
    pub async fn enumerate_once(&self) -> Result<bool, MailboxError> {
        let Some(lease) = self
            .repo
            .claim_stream(macro_uuid::generate_uuid_v7())
            .await
            .map_err(|error| claim_failed("enumerate", error))?
        else {
            return Ok(false);
        };
        let span = tracing::info_span!(
            "outlook.sync.enumerate",
            mailbox.link_id = %lease.mailbox.link_id,
            mailbox.sync_generation = lease.mailbox.sync_generation,
            outlook.stream_kind = "mail_folder",
            outlook.page_items = tracing::field::Empty,
            outlook.rows_queued = tracing::field::Empty,
            outlook.delta_advanced = false,
            outlook.folder_initial_complete = lease.initial_complete,
            outlook.cursor_reset = false,
            outlook.notification_wait_ms = lease
                .notification
                .as_ref()
                .map(|notification| telemetry::since_ms(notification.received_at)),
            outlook.outcome = tracing::field::Empty,
            outlook.defer_reason = tracing::field::Empty,
            outlook.defer_seconds = tracing::field::Empty,
            otel.status_description = tracing::field::Empty,
        );
        adopt_notification_trace(&span, lease.notification.as_ref());
        self.enumerate(&lease).instrument(span).await
    }

    async fn enumerate(&self, lease: &StreamLease) -> Result<bool, MailboxError> {
        let span = Span::current();
        let outcome = maintain_lease(
            async {
                Ok(self
                    .provider
                    .changes(lease.mailbox, &lease.folder, lease.position.as_ref())
                    .await?)
            },
            || self.repo.renew(SyncLease::Stream(lease)),
        )
        .await;
        let result = match outcome {
            Ok(page) => {
                span.record(
                    "outlook.page_items",
                    span_int(page.changed.len() + page.removed.len()),
                );
                let checkpoint = matches!(page.position, StreamPosition::Checkpoint(_));
                self.repo.commit_page(lease, &page).await.map(|committed| {
                    span.record("outlook.rows_queued", span_int(committed.queued));
                    span.record("outlook.delta_advanced", true);
                    span.record(
                        "outlook.folder_initial_complete",
                        lease.initial_complete || checkpoint,
                    );
                    committed.import_completed
                })
            }
            Err(MailboxError::Provider(EmailApiError::OutdatedCursor)) => {
                span.record("outlook.cursor_reset", true);
                self.repo.reset_stream(lease).await.map(|()| None)
            }
            Err(MailboxError::Provider(error)) => {
                let delay = retry_seconds(&error);
                let error = MailboxError::from(error);
                self.repo
                    .release_stream(lease, delay)
                    .await
                    .inspect_err(|release| {
                        record_failed(&span, lease.mailbox.link_id, release);
                    })?;
                record_deferred(&span, lease.mailbox.link_id, &error, delay);
                return Err(error);
            }
            Err(error) => Err(error),
        };
        match result {
            Ok(import_completed) => {
                record_done(&span, "imported");
                if let Some(completed) = import_completed {
                    self.report_import_completed(&completed).await;
                }
                Ok(true)
            }
            Err(error) => {
                record_failed(&span, lease.mailbox.link_id, &error);
                Err(error)
            }
        }
    }

    pub async fn reconcile_once(&self) -> Result<bool, MailboxError> {
        let Some(lease) = self
            .repo
            .claim_message(macro_uuid::generate_uuid_v7())
            .await
            .map_err(|error| claim_failed("reconcile", error))?
        else {
            return Ok(false);
        };
        let span = tracing::info_span!(
            "outlook.sync.reconcile",
            mailbox.link_id = %lease.mailbox.link_id,
            mailbox.sync_generation = lease.mailbox.sync_generation,
            outlook.is_import = lease.is_import,
            outlook.attempts = lease.attempts,
            outlook.graph_calls = tracing::field::Empty,
            outlook.attachments = tracing::field::Empty,
            outlook.calendar_parts_unavailable = tracing::field::Empty,
            outlook.db_write_ms = tracing::field::Empty,
            outlook.notification_lag_ms = tracing::field::Empty,
            outlook.outcome = tracing::field::Empty,
            outlook.defer_reason = tracing::field::Empty,
            outlook.defer_seconds = tracing::field::Empty,
            otel.status_description = tracing::field::Empty,
        );
        adopt_notification_trace(&span, lease.notification.as_ref());
        self.reconcile(&lease).instrument(span).await
    }

    async fn reconcile(&self, lease: &MessageLease) -> Result<bool, MailboxError> {
        let span = Span::current();
        let operation = async {
            let folders = self.repo.folders(lease.mailbox).await?;
            let (snapshot, graph_calls) = email_api_client_core::request_count::counted(
                self.provider
                    .message(lease.mailbox, &lease.provider_id, &folders),
            )
            .await;
            span.record("outlook.graph_calls", i64::from(graph_calls));
            let started = Instant::now();
            let outcome = match snapshot? {
                Some(snapshot) => {
                    span.record(
                        "outlook.attachments",
                        span_int(snapshot.content.message.attachments.len()),
                    );
                    if snapshot.calendar_parts_unavailable {
                        if lease.attempts < CALENDAR_PARTS_ATTEMPTS {
                            return Err(MailboxError::CalendarPartsUnavailable);
                        }
                        span.record("outlook.calendar_parts_unavailable", true);
                        tracing::warn!(
                            link_id = %lease.mailbox.link_id,
                            attempts = lease.attempts,
                            "outlook invitation imported without calendar parts"
                        );
                    }
                    self.ingest.ingest(lease, snapshot).await?;
                    "imported"
                }
                None if lease.attempts < 3 => return Err(MailboxError::LocationUnsettled),
                None => {
                    self.ingest.absent(lease).await?;
                    "absent"
                }
            };
            let import_completed = self.repo.complete_message(lease).await?;
            span.record("outlook.db_write_ms", elapsed_ms(started));
            Ok((outcome, import_completed))
        };
        let result = maintain_lease(operation, || self.repo.renew(SyncLease::Message(lease))).await;
        let error = match result {
            Ok((outcome, import_completed)) => {
                record_done(&span, outcome);
                if let Some(notification) = &lease.notification {
                    span.record(
                        "outlook.notification_lag_ms",
                        telemetry::since_ms(notification.received_at),
                    );
                }
                if outcome == "imported" {
                    self.imports
                        .record(lease.mailbox.link_id, chrono::Utc::now());
                }
                if let Some(completed) = import_completed {
                    self.report_import_completed(&completed).await;
                }
                return Ok(true);
            }
            Err(error) => error,
        };
        let retry = message_retry(&error, lease.attempts);
        self.repo
            .release_message(lease, retry)
            .await
            .inspect_err(|release| {
                record_failed(&span, lease.mailbox.link_id, release);
            })?;
        match retry {
            _ if matches!(error, MailboxError::Stale) => {
                record_failed(&span, lease.mailbox.link_id, &error);
            }
            MessageRetry::After { seconds, .. } => {
                record_deferred(&span, lease.mailbox.link_id, &error, seconds);
            }
            MessageRetry::Abandon => {
                record_abandoned(&span, lease.mailbox.link_id, &error, lease.attempts);
            }
        }
        Err(error)
    }

    async fn report_import_completed(&self, completed: &ImportCompleted) {
        let graph_calls = self.provider.admitted_requests(completed.mailbox).await;
        progress::log_import_completed(completed, graph_calls);
    }
}

/// Work a notification made due continues the webhook request's trace.
fn adopt_notification_trace(span: &Span, notification: Option<&Notification>) {
    let traceparent = notification.and_then(|notification| notification.traceparent.as_deref());
    traceparent::adopt(span, traceparent);
}

/// Keep long catalogue scans and uploads fenced without imposing an arbitrary
/// mailbox-size limit. Losing ownership cancels the operation, never its successor.
pub(crate) async fn maintain_lease<F, H, HF, T>(
    operation: F,
    mut renew: H,
) -> Result<T, MailboxError>
where
    F: Future<Output = Result<T, MailboxError>>,
    H: FnMut() -> HF,
    HF: Future<Output = Result<(), MailboxError>>,
{
    tokio::pin!(operation);
    loop {
        tokio::select! {
            result = &mut operation => return result,
            _ = tokio::time::sleep(std::time::Duration::from_secs(30)) => renew().await?,
        }
    }
}

/// Claims after which a message the provider keeps refusing outright
/// (malformed, forbidden) is abandoned: 3 tries, 10 minutes apart.
const PERMANENT_FAILURE_ATTEMPTS: i32 = 3;

/// Claims after which a message that keeps failing for any other reason of
/// its own is abandoned. With the backoff below that is about a day.
const MESSAGE_FAILURE_ATTEMPTS: i32 = 50;

/// The longest backoff. The `outlook-message-parked-too-long` monitor alerts
/// above 30 minutes, which only a Graph `Retry-After` should reach.
const MAX_BACKOFF_SECONDS: u32 = 1800;

/// Claims an invitation waits for its MIME source before it is imported
/// without calendar parts.
const CALENDAR_PARTS_ATTEMPTS: i32 = 3;

/// How a failed reconciliation is retried. `attempts` counts this claim.
/// Throttling and credential failures belong to the mailbox, not the message,
/// so they keep their own delays and never move it closer to abandonment.
fn message_retry(error: &MailboxError, attempts: i32) -> MessageRetry {
    match error {
        MailboxError::Provider(
            error @ (EmailApiError::RateLimited { .. }
            | EmailApiError::CredentialsUnavailable { .. }
            | EmailApiError::AuthRequired),
        ) => MessageRetry::After {
            seconds: retry_seconds(error),
            counted: false,
        },
        MailboxError::Provider(EmailApiError::Permanent { .. } | EmailApiError::Forbidden) => {
            if attempts >= PERMANENT_FAILURE_ATTEMPTS {
                MessageRetry::Abandon
            } else {
                MessageRetry::After {
                    seconds: 600,
                    counted: true,
                }
            }
        }
        MailboxError::Stale => MessageRetry::After {
            seconds: 30,
            counted: true,
        },
        _ if attempts >= MESSAGE_FAILURE_ATTEMPTS => MessageRetry::Abandon,
        // 30 s doubling to 30 minutes: 30, 60, 120, ... 960, then 1800.
        _ => MessageRetry::After {
            seconds: (30_u32 << attempts.clamp(1, 7).saturating_sub(1)).min(MAX_BACKOFF_SECONDS),
            counted: true,
        },
    }
}

fn retry_seconds(error: &EmailApiError) -> u32 {
    match error {
        EmailApiError::RateLimited {
            retry_after: Some(delay),
            ..
        } => delay.as_secs().clamp(1, 86_400) as u32,
        EmailApiError::AuthRequired | EmailApiError::Forbidden => 300,
        EmailApiError::Permanent { .. } => 600,
        _ => 30,
    }
}
