//! Capability contracts. Lifecycle policy belongs in domain services; adapters implement
//! atomic persistence and external I/O. Only the worker composition root coordinates
//! transaction-aware helpers from other domains.

use std::{future::Future, pin::Pin};

use chrono::{DateTime, Utc};
use entity_access::domain::models::{AdminTeamRole, EntityAccessReceipt};
use futures::Stream;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::models::*;

/// Internal failures retain diagnostic causes without serializing them into progress.
pub type PortResult<T> = Result<T, rootcause::Report<ImportError>>;

/// Bounded chunks, not a buffered whole object. Adapters cap chunk size and stop at
/// the descriptor byte limit; consumers additionally enforce NDJSON line/record bounds.
pub type ByteStream = Pin<Box<dyn Stream<Item = PortResult<Vec<u8>>> + Send>>;

/// Admin-facing use cases. Every call derives the team and actor from the receipt,
/// checks job ownership, and never trusts a body-supplied team or object location.
pub trait ImportService: Send + Sync + 'static {
    /// Persist full metadata/source binding. Same scoped token and semantic payload
    /// returns the original job even after registration closes; different payload conflicts.
    fn create(
        &self,
        access: EntityAccessReceipt<AdminTeamRole>,
        command: CreateImport,
    ) -> impl Future<Output = Result<ImportProgress, ImportError>> + Send;

    /// Register at most 50 descriptors and issue short-lived, conditional upload grants.
    /// Identical retries renew grants; sealed descriptors cannot change or be extended.
    fn register_uploads(
        &self,
        access: EntityAccessReceipt<AdminTeamRole>,
        job: JobId,
        command: RegisterUploads,
    ) -> impl Future<Output = Result<Vec<UploadGrant>, ImportError>> + Send;

    /// Verify persisted descriptors against storage; atomically seal and enqueue via
    /// outbox only when users and every required part are verified. Never publish directly.
    fn complete_uploads(
        &self,
        access: EntityAccessReceipt<AdminTeamRole>,
        job: JobId,
        command: CompleteUploads,
    ) -> impl Future<Output = Result<ImportProgress, ImportError>> + Send;

    /// Idempotently close registration and skip never-ready conversations, without
    /// skipping queued/importing work. Shares the job lock/CAS with completion/cancel.
    fn finalize(
        &self,
        access: EntityAccessReceipt<AdminTeamRole>,
        command: JobCommand,
    ) -> impl Future<Output = Result<ImportProgress, ImportError>> + Send;

    /// Stop future claims/publication and skip unclaimed work. Active leases may finish;
    /// terminal cancellation waits for settlement. Committed history is never rolled back.
    fn cancel(
        &self,
        access: EntityAccessReceipt<AdminTeamRole>,
        command: JobCommand,
    ) -> impl Future<Output = Result<ImportProgress, ImportError>> + Send;

    /// Return sanitized durable progress; inaccessible jobs are indistinguishable from missing jobs.
    fn progress(
        &self,
        access: EntityAccessReceipt<AdminTeamRole>,
        command: JobCommand,
    ) -> impl Future<Output = Result<ImportProgress, ImportError>> + Send;

    /// Up to 50 receipts in descending job-ID order, exclusively before `before`.
    fn list(
        &self,
        access: EntityAccessReceipt<AdminTeamRole>,
        before: Option<JobId>,
    ) -> impl Future<Output = Result<ImportPage, ImportError>> + Send;
}

/// Claimed-work use cases, separate from administrator and maintenance services.
/// The split lets the driver start heartbeats before slow storage or database work.
pub trait ImportWorker: Send + Sync + 'static {
    /// Load the durable requester and revalidate authorization before claiming/reclaiming.
    fn claim(
        &self,
        event: &ImportEvent,
        owner: WorkerId,
    ) -> impl Future<Output = PortResult<ClaimOutcome>> + Send;

    /// Process bounded atomic batches and durably settle permanent outcomes.
    fn import(
        &self,
        context: &ClaimedConversation,
    ) -> impl Future<Output = PortResult<WorkerOutcome>> + Send;

    /// Renew the fence using database time. Any failure stops the current attempt.
    fn heartbeat(&self, lease: &Lease) -> impl Future<Output = PortResult<Lease>> + Send;
}

/// Team-scoped persistence used by the admin service. All mutations serialize on
/// the same job lock/CAS. Implementations enforce persisted invariants inside the
/// transaction as well as accepting domain-validated commands.
pub trait ImportRepo: Send + Sync + 'static {
    /// Atomically bind the source and create metadata under (team, admin, token).
    /// Check semantic equality on replay; never overwrite an existing create payload.
    fn create(
        &self,
        team: TeamId,
        admin: &MacroUserIdStr<'_>,
        command: &CreateImport,
        limits: &ImportLimits,
    ) -> impl Future<Output = PortResult<ImportProgress>> + Send;

    /// Persist immutable descriptors and server-generated keys. Reject unknown
    /// conversations, aggregate byte overflow and additions/changes after seal/closure.
    /// Exact descriptor retries remain readable for grant renewal while uploads are open.
    fn register(
        &self,
        team: TeamId,
        job: JobId,
        command: &RegisterUploads,
    ) -> impl Future<Output = PortResult<Vec<RegisteredUpload>>> + Send;

    /// Resolve only identities already registered to this team/job. Prefix matching
    /// is never sufficient authorization for a storage object.
    fn uploads(
        &self,
        team: TeamId,
        job: JobId,
        uploads: &[UploadId],
    ) -> impl Future<Output = PortResult<Vec<RegisteredUpload>>> + Send;

    /// Compare verified objects to persisted descriptors and apply an optional seal
    /// against the ENTIRE registered set. Readiness plus unique outbox events commit
    /// atomically. A verified users payload can make several sealed conversations ready.
    /// Replays are idempotent; no terminal state can be resurrected.
    fn complete(
        &self,
        team: TeamId,
        job: JobId,
        verified: &[VerifiedUpload],
        seal: Option<&ConversationSeal>,
    ) -> impl Future<Output = PortResult<ImportProgress>> + Send;

    /// Close registration, skip only never-ready work, and recompute the job atomically.
    fn finalize(
        &self,
        team: TeamId,
        job: JobId,
    ) -> impl Future<Output = PortResult<ImportProgress>> + Send;

    /// Close registration, suppress future claims/publications, skip unclaimed work,
    /// and enter Cancelling until all active leases settle.
    fn cancel(
        &self,
        team: TeamId,
        job: JobId,
    ) -> impl Future<Output = PortResult<ImportProgress>> + Send;

    /// Load a team-owned receipt, without exposing storage/lease/internal diagnostics.
    fn progress(
        &self,
        team: TeamId,
        job: JobId,
    ) -> impl Future<Output = PortResult<Option<ImportProgress>>> + Send;

    /// Original human requester, resolved only within the authorized team/job.
    /// Used for best-effort invalidation, never exposed in progress payloads.
    fn requested_by(
        &self,
        team: TeamId,
        job: JobId,
    ) -> impl Future<Output = PortResult<Option<MacroUserIdStr<'static>>>> + Send;

    /// At most 50 team-owned receipts, descending job ID, exclusively before the cursor.
    fn list(
        &self,
        team: TeamId,
        before: Option<JobId>,
    ) -> impl Future<Output = PortResult<Vec<ImportProgress>>> + Send;
}

/// Durable execution state; no historical message inserts belong in this repository.
pub trait ExecutionRepo: Send + Sync + 'static {
    /// Look up the persisted requester before attempting a claim; queue contents are
    /// not authorization. None means unknown/stale work and must not disclose job data.
    fn requester(
        &self,
        event: &ImportEvent,
    ) -> impl Future<Output = PortResult<Option<(TeamId, MacroUserIdStr<'static>)>>> + Send;

    /// Claim Queued work or reclaim expired Importing work using database time and a
    /// fresh token/generation. Reject cancellation and stale event generations. The
    /// caller must revalidate the persisted administrator before every claim/reclaim.
    fn claim(
        &self,
        event: &ImportEvent,
        owner: WorkerId,
    ) -> impl Future<Output = PortResult<ClaimOutcome>> + Send;

    /// Renew only an unexpired matching lease. Return its new persisted expiry.
    /// The queue driver separately extends delivery visibility every 60 seconds.
    fn heartbeat(&self, lease: &Lease) -> impl Future<Output = PortResult<Lease>> + Send;

    /// Fenced final transition plus job recomputation. Only Completed, Skipped or
    /// Failed are allowed. Running work may finish after cancellation; committed
    /// history must retain/schedule its dirty-search work even on failure.
    fn settle(
        &self,
        lease: &Lease,
        status: ConversationStatus,
        error: Option<ImportError>,
    ) -> impl Future<Output = PortResult<()>> + Send;

    /// Unpublished import events in bounded pages. Exclude cancelled jobs under
    /// the same job lock/CAS; deliveries racing cancellation still fail claim.
    fn pending_events(
        &self,
        limit: u32,
    ) -> impl Future<Output = PortResult<Vec<ImportEvent>>> + Send;

    /// Mark an exact outbox generation published only after successful send.
    /// Send followed by a crash may duplicate delivery, but cannot lose work.
    fn mark_published(&self, event: &ImportEvent) -> impl Future<Output = PortResult<()>> + Send;

    /// Persist an exhausted event's failure and recompute its job; stale generations
    /// and newer active leases must not be failed by an old dead-letter delivery.
    fn dead_letter(
        &self,
        event: &ImportEvent,
    ) -> impl Future<Output = PortResult<WorkerOutcome>> + Send;

    /// Bounded recovery using database time: republish recoverable expired work;
    /// settle cancelled expired work without restarting; close abandoned uploads.
    /// Retain partial counts and dirty search markers in every path.
    fn reconcile(&self, limit: u32) -> impl Future<Output = PortResult<()>> + Send;

    /// Pending scoped search work, including partial failed/cancelled imports.
    fn pending_search(
        &self,
        limit: u32,
    ) -> impl Future<Output = PortResult<Vec<SearchBackfill>>> + Send;

    /// Store submission receipts or polled state only for the matching dirty generation.
    /// A receipt for an older generation cannot clear newer committed dirty work.
    fn record_search(
        &self,
        request: &SearchBackfill,
        state: SearchState,
    ) -> impl Future<Output = PortResult<()>> + Send;
}

/// Immutable bounded object storage. Implementations never unzip an archive.
pub trait ImportStorage: Send + Sync + 'static {
    /// Sign checksum, exact length, derived content type and create-only condition.
    /// A retry reporting "already exists" requests verification, never overwrite access.
    fn grant(
        &self,
        upload: &RegisteredUpload,
    ) -> impl Future<Output = PortResult<UploadGrant>> + Send;

    /// Compare storage's actual checksum and length (not ETag/user metadata), returning
    /// the pinned identity only when all immutable descriptor properties match.
    fn verify(
        &self,
        upload: &RegisteredUpload,
    ) -> impl Future<Output = PortResult<VerifiedUpload>> + Send;

    /// Stream bounded chunks from a pinned verified object. Reject a changed identity
    /// and enforce the total byte limit even if storage supplied incorrect metadata.
    fn read(&self, upload: &VerifiedUpload) -> impl Future<Output = PortResult<ByteStream>> + Send;
}

/// Publication only. Receive/ack/visibility handles belong to the worker driver,
/// not to domain messages, and no queue payload carries trusted storage keys.
pub trait ImportQueue: Send + Sync + 'static {
    /// Publish an identity-only event; duplicates are expected and safe.
    fn publish(&self, event: &ImportEvent) -> impl Future<Output = PortResult<()>> + Send;
}

/// Delivery controls with opaque adapter-owned receipts. Payloads remain untrusted.
/// The driver receives only one delivery per available processing slot.
pub trait ImportConsumer: Send + Sync {
    /// Opaque acknowledgement capability; never logged or persisted as domain state.
    type Delivery: Send + Sync;

    /// Long-poll one message from the main queue or its dead-letter queue.
    fn receive(
        &self,
        dead_letter: bool,
    ) -> impl Future<Output = PortResult<Option<Self::Delivery>>> + Send;
    /// Strictly decoded identity plus the provider's approximate receive count.
    fn envelope(delivery: &Self::Delivery) -> (Result<ImportEvent, ImportError>, u32);
    /// Extend delivery visibility independently of the database fence.
    fn extend(&self, delivery: &Self::Delivery) -> impl Future<Output = PortResult<()>> + Send;
    /// Acknowledge only a durable outcome, or an unidentifiable poison envelope.
    fn delete(&self, delivery: &Self::Delivery) -> impl Future<Output = PortResult<()>> + Send;
}

/// Separate requester and target authorization, evaluated by domain orchestration.
pub trait ImportAuthorizer: Send + Sync + 'static {
    /// Revalidate the original requester's current team-admin role before work/reclaim.
    fn require_admin(
        &self,
        team: TeamId,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = PortResult<()>> + Send;

    /// Authorize target type, team provenance and requester access independently of
    /// source claims. Private/DM reuse requires access or durable team import provenance.
    /// Failure skips the conversation without revealing an inaccessible target ID.
    fn require_target(
        &self,
        team: TeamId,
        user: &MacroUserIdStr<'_>,
        metadata: &ConversationMetadata,
        target: Uuid,
    ) -> impl Future<Output = PortResult<()>> + Send;
}

/// Read-only disclosure for administrator receipts, separate from import-write authority.
pub trait ImportProgressAccess: Send + Sync + 'static {
    /// Return targets in which this viewer currently participates. Conservatively
    /// omit all other IDs, including team-visible channels without participation.
    /// Inputs are deduplicated and bounded to 500 IDs per call.
    fn participating_targets(
        &self,
        viewer: &MacroUserIdStr<'_>,
        targets: &[Uuid],
    ) -> impl Future<Output = PortResult<Vec<Uuid>>> + Send;
}

/// Best-effort invalidation only; persisted polling is the source of truth.
pub trait ImportNotifier: Send + Sync + 'static {
    /// Notify the requesting administrator's gateway entity of a job revision using
    /// `slack_import_updated`; other admins poll. No keys, source content, target IDs
    /// or detailed progress in the payload. Caller revalidates admin access first.
    fn invalidate(
        &self,
        requester: &MacroUserIdStr<'_>,
        team: TeamId,
        job: JobId,
        revision: u64,
        status: JobStatus,
    ) -> impl Future<Output = PortResult<()>> + Send;
}

/// Import-owned canonical target/ledger service shared by archive and onboarding.
/// Cross-domain adapters depend on this port, not the import crate's outbound module.
pub trait ImportLedger: Send + Sync + 'static {
    /// Read the team's single-source binding for the admin picker.
    fn source_binding(
        &self,
        team: TeamId,
    ) -> impl Future<Output = PortResult<SourceBinding>> + Send;

    /// Atomically reserve or return the stable target for (team, Slack, foreign ID).
    /// Ambiguous legacy mappings fail closed; never allocate a second candidate.
    /// Pass the persisted requester and metadata, not queue-supplied context. An
    /// existing target must already be independently authorized by the caller.
    fn reserve(
        &self,
        team: TeamId,
        requester: &MacroUserIdStr<'static>,
        metadata: &ConversationMetadata,
        authorized_existing_target: Option<Uuid>,
    ) -> impl Future<Output = PortResult<TargetReservation>> + Send;

    /// Mark a successfully created reserved target ready, preserving the first mapping.
    /// Private/DM provenance must not leak through the team-wide onboarding listing.
    fn complete(
        &self,
        reservation: &TargetReservation,
        kind: ConversationKind,
    ) -> impl Future<Output = PortResult<()>> + Send;
}

/// Worker composition-root coordinator for a transaction spanning owning-crate helpers.
/// Domain signatures never expose SQL transactions. No live send/message effects.
pub trait HistoricalSink: Send + Sync + 'static {
    /// Resolve bounded thread-parent/source mappings; first committed source ID wins.
    fn lookup(
        &self,
        sources: &[SourceMessageId],
    ) -> impl Future<Output = PortResult<Vec<(SourceMessageId, Uuid)>>> + Send;

    /// Atomically commit messages, reactions, mentions, source mappings, checkpoint,
    /// counters and dirty-search marker under the lease fence. Roll back EVERYTHING
    /// on failure; validate team/channel/parent ownership and count/byte bounds.
    /// Return cumulative committed counters, not speculative attempted inserts.
    fn commit(
        &self,
        batch: HistoricalBatch,
    ) -> impl Future<Output = PortResult<ImportCounters>> + Send;
}

/// Explicit scoped search indexing, independent of historical persistence completion.
pub trait SearchBackfillClient: Send + Sync + 'static {
    /// Submit only named imported channels; return acceptance receipt, not completion.
    fn submit(&self, request: &SearchBackfill) -> impl Future<Output = PortResult<Uuid>> + Send;

    /// Poll a stored receipt and distinguish accepted/running from complete/failed.
    fn progress(&self, receipt: Uuid) -> impl Future<Output = PortResult<SearchState>> + Send;
}

/// Injectable time for grant expiry and service policy; lease fences use database time.
pub trait Clock: Send + Sync + 'static {
    /// Current wall-clock time.
    fn now(&self) -> DateTime<Utc>;
}
