//! Durable mailbox enumeration independent from provider-specific notifications.

use crate::domain::backfill_jobs::worker::is_unstorable_sqlstate;
use email_api_client::domain::models::{
    EmailApiError, MailFolder, MailFolderCatalog, MailboxChangePage, MailboxMessage, ProviderId,
    RoundStart, StreamPosition, StreamToken,
};
use live_pass::{FolderPass, LiveImportPass, StreamKind};
use progress::{ImportCompleted, ImportTally};
use retry::{message_retry, retry_seconds};
use std::future::Future;
use std::time::Instant;
use telemetry::{
    claim_failed, elapsed_ms, enumerate_span, is_gate_refusal, record_abandoned, record_deferred,
    record_done, record_failed, span_int,
};
use tracing::{Instrument, Span};
use uuid::Uuid;

pub mod calendar_disconnect;
pub mod catalog;
pub mod commands;
pub mod connection;
pub mod contacts;
pub mod credentials;
pub mod drafts;
pub mod gmail_history;
pub mod gmail_push;
pub mod health;
/// Per-delivery Gmail inbox admission and reconciliation.
pub mod inbox_sync;
pub mod initialization;
pub mod lifecycle;
/// Link-maintenance queue decisions and reconnect notification selection.
pub mod link_manager;
pub mod live_pass;
pub mod progress;
pub mod projection;
pub mod reimport;
mod retry;
pub mod settings;
pub mod telemetry;
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
    /// The database refused a value the work carries with this SQLSTATE
    /// ([`is_unstorable_sqlstate`]), so it fails the same way every time.
    #[error("mailbox data cannot be stored: sqlstate {0}")]
    Unstorable(String),
    /// A projection's downstream effect (event publishing, a queue, another
    /// service) failed or is not ready.
    #[error("a mailbox projection effect is unavailable: {0}")]
    Effect(EffectFailure),
    #[error("mailbox generation or worker lease changed")]
    Stale,
    /// The provider does not return the message a live change named; a later
    /// attempt either finds it or settles that it is gone.
    #[error("mailbox message location has not settled")]
    LocationUnsettled,
    /// The message reads as an invitation, but the provider would not return
    /// its MIME source; a later attempt imports it without calendar parts.
    #[error("the invitation's calendar parts are unavailable")]
    CalendarPartsUnavailable,
    /// The account has no mailbox the provider will serve: discovery found no
    /// Inbox. The link is marked until a later discovery finds one.
    #[error("the account has no mailbox the provider will serve")]
    NoMailbox,
    /// The message's last claims all ended without an outcome: each worker
    /// reading it stopped (a read that runs the worker out of memory kills
    /// every worker that claims it) and its lease expired.
    #[error("the message's last {0} claims ended without an outcome")]
    ClaimsUnfinished(i32),
    /// The draft was edited outside Macro, or may have been, so neither copy
    /// overwrites the other.
    #[error("the draft changed outside Macro")]
    DraftChanged(drafts::models::DraftChange),
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

impl MailboxError {
    /// A failed database call. A value the database will never accept is the
    /// data's fault, not an outage, so it is `Unstorable` rather than `Database`.
    pub fn database(failure: DatabaseFailure) -> Self {
        match failure {
            DatabaseFailure::Sqlstate(code) if is_unstorable_sqlstate(&code) => {
                Self::Unstorable(code)
            }
            failure => Self::Database(failure),
        }
    }

    /// Whether a database call gave up waiting for a lock (see
    /// [`DatabaseFailure::is_lock_timeout`]).
    pub fn is_lock_timeout(&self) -> bool {
        matches!(self, Self::Database(failure) if failure.is_lock_timeout())
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

impl DatabaseFailure {
    /// Whether the statement gave up waiting for a lock. The rows were busy,
    /// not wrong, so the same work succeeds once their holder finishes.
    pub fn is_lock_timeout(&self) -> bool {
        matches!(self, Self::Sqlstate(code) if code == super::models::error::LOCK_NOT_AVAILABLE)
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
    /// Which of the folder's streams this is.
    pub pass: FolderPass,
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
    /// Claims of this revision in a row before this one that ended without
    /// recording an outcome: their worker stopped while it held the lease.
    pub unfinished_claims: i32,
    /// The newest change notification that queued this message.
    pub notification: Option<Notification>,
    /// A change notification queued this message by the id it names, not a
    /// folder page.
    pub from_notification: bool,
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
    /// Marks the lease's link as having no mailbox the provider will serve,
    /// unless it already is, and answers how many seconds it has been
    /// marked. Every claim but the catalog's skips a marked link; a committed
    /// catalog or a reconnect clears the mark.
    fn mark_no_mailbox(
        &self,
        lease: &CatalogLease,
    ) -> impl Future<Output = Result<u32, MailboxError>> + Send;
    /// Claims the longest-due stream of `kind`, except that a mail folder's
    /// import round goes ahead of finished folders that came due less than
    /// five minutes before it, so its next page is read once its mailbox has
    /// room instead of behind every poll.
    fn claim_stream(
        &self,
        lease_id: Uuid,
        kind: StreamKind,
    ) -> impl Future<Output = Result<Option<StreamLease>, MailboxError>> + Send;
    /// Atomically records every changed/removed ID and advances the opaque
    /// cursor only while this generation and lease fence are still current.
    fn commit_page(
        &self,
        lease: &StreamLease,
        page: &MailboxChangePage,
    ) -> impl Future<Output = Result<CommittedPage, MailboxError>> + Send;
    /// Reset only this expired stream; this operation never removes messages.
    /// Its folder's live pass goes with the round it ran beside.
    fn reset_stream(
        &self,
        lease: &StreamLease,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    /// Opens the folder's live pass while the import round `lease` read a
    /// page of still runs. An open pass is left as it is.
    fn open_live_pass(
        &self,
        lease: &StreamLease,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    /// Starts an expired live pass over from now. Unlike `reset_stream`, it
    /// requeues nothing: mail it missed is in the folder's import round, or
    /// in the folder's next round once that one ends.
    fn restart_live_pass(
        &self,
        lease: &StreamLease,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn release_stream(
        &self,
        lease: &StreamLease,
        retry_after_seconds: u32,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    /// Puts the stream back for `retry_after_seconds`, unread, while its
    /// mailbox has at least `queued` import messages due. Returns whether it
    /// did.
    fn pace_import(
        &self,
        lease: &StreamLease,
        queued: u32,
        retry_after_seconds: u32,
    ) -> impl Future<Output = Result<bool, MailboxError>> + Send;
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
    /// token), or a provider failure once its backoff is at the longest, is not
    /// `counted`, so it gives the claim back to `attempts`.
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
    ) -> impl Future<Output = Result<MailFolderCatalog, EmailApiError>> + Send;
    /// One page of a folder's delta round. `start` says what a new round
    /// (no `position`) lists; a position carries it.
    fn changes(
        &self,
        mailbox: MailboxKey,
        folder: &ProviderId,
        position: Option<&StreamToken>,
        start: RoundStart,
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
    /// Whether the mailbox already stores the leased message.
    fn stored(
        &self,
        lease: &MessageLease,
    ) -> impl Future<Output = Result<bool, MailboxError>> + Send;
}

pub struct MailboxSyncService<R, P, I> {
    repo: R,
    provider: P,
    /// Reads an import: a folder's first delta round and the messages it
    /// queues. The host gives it a provider that leaves room under the
    /// mailbox's provider limits for the live work `provider` reads, and that
    /// waits briefly for that room instead of parking the work.
    import_provider: P,
    ingest: I,
    imports: ImportTally,
    live_pass: LiveImportPass,
}

impl<R, P, I> MailboxSyncService<R, P, I> {
    pub fn new(repo: R, provider: P, import_provider: P, ingest: I) -> Self {
        Self {
            repo,
            provider,
            import_provider,
            ingest,
            imports: ImportTally::default(),
            live_pass: LiveImportPass::default(),
        }
    }

    /// Reads new mail beside import rounds, and imports newest first, while
    /// `switch` is on.
    pub fn with_live_import_pass(mut self, switch: LiveImportPass) -> Self {
        self.live_pass = switch;
        self
    }

    fn provider_for(&self, is_import: bool) -> &P {
        if is_import {
            &self.import_provider
        } else {
            &self.provider
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
            outlook.provider_item_count = tracing::field::Empty,
            graph.error_code = tracing::field::Empty,
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
            Ok(MailFolderCatalog::NoMailbox { error_code }) => {
                span.record("graph.error_code", error_code.as_deref());
                return self.park_without_mailbox(lease).await;
            }
            Ok(MailFolderCatalog::Folders(folders)) => {
                span.record("outlook.folders", span_int(folders.len()));
                span.record(
                    "outlook.provider_item_count",
                    span_int(
                        folders
                            .iter()
                            .filter_map(|folder| folder.total_items)
                            .map(u64::from)
                            .sum::<u64>(),
                    ),
                );
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

    /// The provider serves no mailbox for the account. Every claim but this
    /// catalog's skips the marked link, and discovery alone looks again,
    /// waiting as long as the link has been marked (30 s at first, at most
    /// the 12 h a working subscription waits), so its probes double apart.
    /// The first discovery that finds the mailbox clears the mark.
    async fn park_without_mailbox(&self, lease: &CatalogLease) -> Result<bool, MailboxError> {
        let span = Span::current();
        let link_id = lease.mailbox.link_id;
        let marked_seconds = self
            .repo
            .mark_no_mailbox(lease)
            .await
            .inspect_err(|error| record_failed(&span, link_id, error))?;
        let delay =
            marked_seconds.clamp(NO_MAILBOX_FIRST_PROBE_SECONDS, NO_MAILBOX_PROBE_MAX_SECONDS);
        self.repo
            .release_catalog(lease, delay)
            .await
            .inspect_err(|error| record_failed(&span, link_id, error))?;
        let error = MailboxError::NoMailbox;
        record_deferred(&span, link_id, &error, delay);
        Err(error)
    }

    /// Process one bounded provider page. Notifications only make streams due;
    /// periodic polling recovers missed, duplicate and out-of-order notifications.
    ///
    /// An import round that waits for room in its mailbox's import (paced, or
    /// refused by the request gate) reads nothing, so the claim moves on to
    /// the next due stream. Import rounds are claimed ahead of finished
    /// folders, and a waiting round is due again seconds later: without
    /// moving on, a large mailbox's waiting rounds would take the turns every
    /// other mailbox's new mail needs.
    pub async fn enumerate_once(&self) -> Result<bool, MailboxError> {
        for _ in 0..PACED_CLAIMS_PER_TURN {
            let Some(lease) = self
                .claim_folder_stream()
                .await
                .map_err(|error| claim_failed("enumerate", error))?
            else {
                return Ok(false);
            };
            let span = enumerate_span(&lease);
            adopt_notification_trace(&span, lease.notification.as_ref());
            // Only an import round waiting for room comes back without reading.
            if self.enumerate(&lease).instrument(span).await? {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// New mail goes first: a due live pass is claimed before any folder.
    async fn claim_folder_stream(&self) -> Result<Option<StreamLease>, MailboxError> {
        if self.live_pass.enabled()
            && let Some(lease) = self
                .repo
                .claim_stream(macro_uuid::generate_uuid_v7(), StreamKind::LivePass)
                .await?
        {
            return Ok(Some(lease));
        }
        self.repo
            .claim_stream(macro_uuid::generate_uuid_v7(), StreamKind::MailFolder)
            .await
    }

    /// A failure leaves the folder as it was before the switch: its new mail
    /// waits for the round. The next page tries again.
    async fn open_live_pass(&self, lease: &StreamLease) {
        let opened = self.repo.open_live_pass(lease).await;
        Span::current().record("outlook.live_pass_opened", opened.is_ok());
        if let Err(error) = opened {
            tracing::warn!(
                link_id = %lease.mailbox.link_id,
                error = %error,
                "outlook live pass not opened"
            );
        }
    }

    async fn enumerate(&self, lease: &StreamLease) -> Result<bool, MailboxError> {
        let span = Span::current();
        if !lease.initial_complete {
            match self
                .repo
                .pace_import(lease, IMPORT_QUEUED_AHEAD, IMPORT_PACE_SECONDS)
                .await
            {
                Ok(false) => {}
                Ok(true) => {
                    record_stream(&span, false, false, false);
                    record_done(&span, "paced");
                    return Ok(false);
                }
                Err(error) => {
                    record_failed(&span, lease.mailbox.link_id, &error);
                    return Err(error);
                }
            }
        }
        let outcome = maintain_lease(
            async {
                Ok(self
                    .provider_for(!lease.initial_complete)
                    .changes(
                        lease.mailbox,
                        &lease.folder,
                        lease.position.as_ref(),
                        live_pass::round_start(lease, &self.live_pass),
                    )
                    .await?)
            },
            || self.repo.renew(SyncLease::Stream(lease)),
        )
        .await;
        let mut delta_advanced = false;
        let mut folder_initial_complete = lease.initial_complete;
        let mut cursor_reset = false;
        let result = match outcome {
            Ok(page) => {
                span.record(
                    "outlook.page_items",
                    span_int(page.changed.len() + page.removed.len()),
                );
                let checkpoint = matches!(page.position, StreamPosition::Checkpoint(_));
                let committed = self.repo.commit_page(lease, &page).await;
                if committed.is_ok() && live_pass::opens(lease, checkpoint, &self.live_pass) {
                    self.open_live_pass(lease).await;
                }
                committed.map(|committed| {
                    span.record("outlook.rows_queued", span_int(committed.queued));
                    delta_advanced = true;
                    folder_initial_complete |= checkpoint;
                    committed.import_completed
                })
            }
            // A live pass only starts over: its folder's rounds list what it
            // missed, so requeueing the folder would only repeat the import.
            Err(MailboxError::Provider(EmailApiError::OutdatedCursor)) => {
                cursor_reset = true;
                match lease.pass {
                    FolderPass::Live { .. } => {
                        self.repo.restart_live_pass(lease).await.map(|()| None)
                    }
                    FolderPass::Folder => self.repo.reset_stream(lease).await.map(|()| None),
                }
            }
            Err(MailboxError::Provider(error)) => {
                // The request gate refuses an import round's page while its
                // mailbox's own message reads hold the import slots, which
                // is a wait for room like pacing: the round waits as long,
                // and the claim moves on to the next stream.
                let delay = retry_seconds(&error);
                let error = MailboxError::from(error);
                let import_busy = !lease.initial_complete && is_gate_refusal(&error);
                let delay = if import_busy {
                    delay.max(IMPORT_PACE_SECONDS)
                } else {
                    delay
                };
                record_stream(&span, delta_advanced, folder_initial_complete, cursor_reset);
                self.repo
                    .release_stream(lease, delay)
                    .await
                    .inspect_err(|release| {
                        record_failed(&span, lease.mailbox.link_id, release);
                    })?;
                record_deferred(&span, lease.mailbox.link_id, &error, delay);
                if import_busy {
                    return Ok(false);
                }
                return Err(error);
            }
            Err(error) => Err(error),
        };
        record_stream(&span, delta_advanced, folder_initial_complete, cursor_reset);
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
            outlook.from_notification = lease.from_notification,
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
        if lease.unfinished_claims >= UNFINISHED_CLAIM_LIMIT {
            return self.abandon_unfinished(&lease).instrument(span).await;
        }
        self.reconcile(&lease).instrument(span).await
    }

    /// Gives up on a message without reading it, since the read is the likely
    /// cause of the workers that stopped. A new change revives it as it does
    /// any abandoned message.
    async fn abandon_unfinished(&self, lease: &MessageLease) -> Result<bool, MailboxError> {
        let span = Span::current();
        let error = MailboxError::ClaimsUnfinished(lease.unfinished_claims);
        self.repo
            .release_message(lease, MessageRetry::Abandon)
            .await
            .inspect_err(|release| record_failed(&span, lease.mailbox.link_id, release))?;
        record_abandoned(&span, lease.mailbox.link_id, &error, lease.attempts);
        Err(error)
    }

    async fn reconcile(&self, lease: &MessageLease) -> Result<bool, MailboxError> {
        let span = Span::current();
        let operation = async {
            let folders = self.repo.folders(lease.mailbox).await?;
            let (snapshot, graph_calls) = email_api_client::domain::request_count::counted(
                self.provider_for(lease.is_import).message(
                    lease.mailbox,
                    &lease.provider_id,
                    &folders,
                ),
            )
            .await;
            span.record("outlook.graph_calls", i64::from(graph_calls));
            let started = Instant::now();
            let snapshot = snapshot?;
            // A notification names messages in every folder, the hidden ones
            // and those created since the last discovery included, while
            // folder pages list only the catalog's folders. A message no
            // folder page would list is not stored; one already stored is
            // read as its folder's page would.
            let unsynced = match &snapshot {
                Some(snapshot)
                    if lease.from_notification
                        && !folders
                            .iter()
                            .any(|folder| Some(&folder.id) == snapshot.folder_id.as_ref()) =>
                {
                    !self.ingest.stored(lease).await?
                }
                _ => false,
            };
            let outcome = match snapshot {
                Some(_) if unsynced => "unsynced",
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
                // Live work follows a change Graph or Macro just made, which
                // Graph's message read can briefly miss, so its 404 is read
                // again. Import work lists what a folder already held, or
                // rechecks mail Macro stored before: its 404 means the message
                // has left the mailbox, or the entry is one Graph lists but
                // never serves as a message (Deleted Items holds them). Ids
                // are immutable, so a message moved meanwhile still reads,
                // and a retry would only repeat the answer later.
                None if !lease.is_import && lease.attempts < 3 => {
                    return Err(MailboxError::LocationUnsettled);
                }
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
    crate::trace_context::adopt(span, traceparent);
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

/// Attempts a write that records a provider call's result gets while its
/// mailbox stays locked, and the wait between them. With each attempt's 5 s
/// lock timeout they take about 80 s, inside one 3 minute lease even before it
/// is renewed.
pub(crate) const AFTER_PROVIDER_ATTEMPTS: u32 = 6;
pub(crate) const AFTER_PROVIDER_RETRY_DELAY: std::time::Duration =
    std::time::Duration::from_secs(10);

/// Retries `write` while it times out on a lock. A later attempt reads the
/// provider's new state as already applied, or as another client's change,
/// so what the call changed has to be recorded now. Each attempt opens its
/// own transaction, so no connection is held between attempts.
pub(crate) async fn record_after_provider<F, W>(
    unit: &'static str,
    mut write: F,
) -> Result<(), MailboxError>
where
    F: FnMut() -> W,
    W: Future<Output = Result<(), MailboxError>>,
{
    let mut attempt = 1;
    loop {
        match write().await {
            Err(error) if attempt < AFTER_PROVIDER_ATTEMPTS && error.is_lock_timeout() => {
                tracing::debug!(
                    unit,
                    attempt,
                    "write after a provider call waits for its mailbox to be free"
                );
                tokio::time::sleep(AFTER_PROVIDER_RETRY_DELAY).await;
                attempt += 1;
            }
            result => return result,
        }
    }
}

/// Due import messages a mailbox may have before its folders' import rounds
/// stop reading pages: two pages. Gmail's backfill lists its next page
/// behind the threads it queued; this keeps an Outlook walk about as far
/// ahead of its import, so another mailbox's import, and a message that waited
/// for room, queue behind a couple of pages rather than the whole import.
const IMPORT_QUEUED_AHEAD: u32 = 200;

/// How long such a folder waits before it checks again. A mailbox imports at
/// most about 12 messages a second, so its two pages outlast the wait.
const IMPORT_PACE_SECONDS: u32 = 10;

/// How soon discovery looks again for a mailbox it found missing, and the
/// longest it waits: the 12 h a working subscription waits for renewal.
const NO_MAILBOX_FIRST_PROBE_SECONDS: u32 = 30;
const NO_MAILBOX_PROBE_MAX_SECONDS: u32 = 12 * 60 * 60;

/// Waiting import rounds one `enumerate_once` passes over before it gives up
/// its turn. Each costs a claim, a count or a gate check, and a release, and
/// no Graph request.
const PACED_CLAIMS_PER_TURN: u32 = 8;

/// Claims in a row that may end without an outcome before a message, or a
/// projection event, is abandoned unread. Its next claim comes when the
/// 3-minute lease expires, so a read that kills its worker kills five, over
/// about 15 minutes, instead of one every few minutes forever. A deploy, or a
/// worker stopped for another reason, leaves one such claim on whatever it
/// was reading.
const UNFINISHED_CLAIM_LIMIT: i32 = 5;

/// Claims an invitation waits for its MIME source before it is imported
/// without calendar parts.
const CALENDAR_PARTS_ATTEMPTS: i32 = 3;

/// What one enumerated page did to its folder's stream, recorded once.
fn record_stream(
    span: &Span,
    delta_advanced: bool,
    folder_initial_complete: bool,
    cursor_reset: bool,
) {
    span.record("outlook.delta_advanced", delta_advanced);
    span.record("outlook.folder_initial_complete", folder_initial_complete);
    span.record("outlook.cursor_reset", cursor_reset);
}
