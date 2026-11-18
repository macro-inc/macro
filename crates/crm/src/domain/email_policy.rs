//! Incarnation-bound storage for policy APIs and workers.
//!
//! These ports neither authorize a caller nor activate selected contribution.
//! The caller supplies an authenticated member and enforces CAS after checking
//! idempotency. A storage transaction keeps that consent's identity stable.

use super::{
    email_rules::{
        EmailContributionMode, EmailPolicyActorKind, EmailPolicyAuditAction, EmailRuleSet,
    },
    model::CrmError,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

/// Identity of one consent lifetime and its database-owned policy version.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct EmailPolicyGeneration {
    /// Fresh server-generated identity, never reused after consent deletion.
    pub consent_incarnation: Uuid,
    /// Monotonic only within this incarnation.
    pub policy_version: i64,
}

/// Whether an authorized mutation initializes identity or requires it to exist.
#[derive(Debug, Clone, Copy)]
pub enum OpenEmailPolicy {
    /// Initialize a legacy row without changing consent. An absent row also
    /// requires the displayed, connected primary mailbox and starts disabled.
    Initialize {
        /// Required only when consent is absent; never retarget an existing row.
        primary_link_id: Option<Uuid>,
    },
    /// A delayed mutation cannot initialize or recreate consent. Version CAS
    /// follows idempotency lookup, so a committed retry can report its outcome.
    Existing {
        /// Previously issued consent identity.
        consent_incarnation: Uuid,
    },
}

/// Locked facts, independent of the member's permission to view CRM records.
#[derive(Debug, Clone)]
pub struct EmailPolicyState {
    /// Exact mailbox retained by consent, including after disconnection.
    pub link_id: Uuid,
    /// Lifetime and policy version used by every modern envelope.
    pub generation: EmailPolicyGeneration,
    /// Stored mode, including a withdrawn selected policy.
    pub mode: EmailContributionMode,
    /// The legacy all-mail grant bit.
    pub enabled: bool,
    /// The separate selected grant bit.
    pub selected_enabled: bool,
    /// Immutable definition currently selected by consent.
    pub active_rule_revision: Option<i64>,
}

/// One committed result, retained for retries within the consent lifetime.
#[derive(Debug, Clone)]
pub struct EmailPolicyIdempotency {
    /// Owner-chosen retry key; it is not a consent token.
    pub request_id: Uuid,
    /// The version the original command compared.
    pub expected_policy_version: i64,
    /// The version recorded by the original commit, not necessarily current.
    pub policy_version: i64,
    /// SHA-256 of the canonical command, including its expected version.
    pub request_hash: Vec<u8>,
    /// Content-free committed response; later APIs identify it as a replay.
    pub outcome: serde_json::Value,
}

/// Content committed for an idempotent command; storage supplies its outcome version.
#[derive(Debug, Clone)]
pub struct NewEmailPolicyIdempotency {
    /// Owner-chosen retry key, scoped to the locked incarnation.
    pub request_id: Uuid,
    /// Version compared by the original command.
    pub expected_policy_version: i64,
    /// SHA-256 of the canonical command.
    pub request_hash: Vec<u8>,
    /// Content-free committed response.
    pub outcome: serde_json::Value,
}

/// Audit data supplied by the authorized use case, without mail content.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct NewEmailPolicyAudit {
    /// Server-generated UUIDv7, stable for a retried system event.
    pub event_id: Uuid,
    /// The operation that committed.
    pub action: EmailPolicyAuditAction,
    /// Provenance derived from authenticated credentials.
    pub actor_kind: EmailPolicyActorKind,
    /// Verified agent identity, if available.
    pub agent_id: Option<Uuid>,
    /// Verified session identity, if available; never inferred from a request.
    pub agent_session_id: Option<Uuid>,
    /// Previous immutable definition.
    pub previous_revision: Option<i64>,
    /// New immutable definition.
    pub next_revision: Option<i64>,
    /// Bounded metadata, never email IDs, addresses, subjects or bodies.
    pub details: serde_json::Value,
}

/// An audit record may predate incarnation-aware writers.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct EmailPolicyAudit {
    /// Stored event and provenance.
    pub entry: NewEmailPolicyAudit,
    /// Exact mailbox at the time of the event.
    pub link_id: Uuid,
    /// Absent only for a legacy audit row.
    pub consent_incarnation: Option<Uuid>,
    /// Committed policy version within the recorded lifetime.
    pub policy_version: i64,
    /// Database commit transaction's creation time.
    pub created_at: DateTime<Utc>,
}

/// Preview state is independent of the contribution grant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EmailPolicyPreviewStatus {
    /// Waiting for bounded asynchronous work.
    Pending,
    /// A worker has made progress.
    Running,
    /// The entire bounded traversal completed.
    Complete,
    /// A budget ended the traversal; counts are explicitly partial.
    Partial,
    /// The owner cancelled the work.
    Cancelled,
    /// Consent or live-source context changed.
    Stale,
}

/// Count-only preview output; no mailbox contents or target identities.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(default, deny_unknown_fields)]
pub struct EmailPolicyPreviewCounts {
    /// Currently included threads encountered so far.
    pub current: u64,
    /// Proposed included threads encountered so far.
    pub proposed: u64,
    /// Threads newly included by the proposal.
    pub added: u64,
    /// Threads held back by the proposal.
    pub removed: u64,
    /// Threads included by both policies.
    pub retained: u64,
    /// Matching threads vetoed by other privacy settings.
    pub denied: u64,
}

/// Stored preview envelope, with one replaceable slot per member.
#[derive(Debug, Clone)]
pub struct EmailPolicyPreview {
    /// Exact job occupying the slot.
    pub preview_id: Uuid,
    /// Consent context captured at creation.
    pub generation: EmailPolicyGeneration,
    /// Live-target context, distinct from the authored policy version.
    pub context_id: Uuid,
    /// Proposed definition; this is not a grant.
    pub definition: EmailRuleSet,
    /// Current job state.
    pub status: EmailPolicyPreviewStatus,
    /// Explicit partial/as-of counts.
    pub counts: EmailPolicyPreviewCounts,
    /// Last completed mailbox-local thread in a keyset traversal.
    pub after_thread_id: Option<Uuid>,
    /// Number of threads traversed, including misses and denials.
    pub scanned_threads: i64,
    /// Preview creation time.
    pub created_at: DateTime<Utc>,
    /// Hard lifetime bound for this job.
    pub expires_at: DateTime<Utc>,
}

/// One checkpoint of the current preview, applied conditionally.
#[derive(Debug, Clone)]
pub struct EmailPolicyPreviewProgress {
    /// Running or a terminal result.
    pub status: EmailPolicyPreviewStatus,
    /// Accumulated counts, not a per-page delta.
    pub counts: EmailPolicyPreviewCounts,
    /// Inclusive keyset checkpoint.
    pub after_thread_id: Option<Uuid>,
    /// Accumulated traversal count; older checkpoints cannot rewind it.
    pub scanned_threads: i64,
}

/// Durable history work survives outbox publication and is replaced atomically.
#[derive(Debug, Clone)]
pub struct EmailPolicyWork {
    /// Exact request; changes even when a source edit keeps the same policy.
    pub work_id: Uuid,
    /// Captured identity and version; never adopted from a later consent.
    pub generation: EmailPolicyGeneration,
    /// Inclusive keyset checkpoint, independent of publication state.
    pub after_thread_id: Option<Uuid>,
    /// Original enqueue time.
    pub requested_at: DateTime<Utc>,
    /// W3C trace context only.
    pub traceparent: Option<String>,
}

/// Source IDs are live references and remain meaningful after source deletion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EmailPolicySourceKind {
    /// Contact addresses or visibility changed.
    Contact,
    /// Company domains or visibility changed.
    Company,
    /// Bulk deletion raced the first rule reference; reconcile raw team owners.
    Team,
}

/// Cursor over raw rule references, including inactive historical revisions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmailPolicySourceReference {
    /// Contributor whose saved rule references the source.
    pub user_id: String,
    /// Saved definition revision; the worker must recheck whether it is active.
    pub revision: i64,
}

/// Durable source change; processing it must never scan a mailbox inline.
#[derive(Debug, Clone)]
pub struct EmailPolicySourceEvent {
    /// Server-generated UUIDv7, stable across a transaction retry.
    pub event_id: Uuid,
    /// Team owning the changed record.
    pub team_id: Uuid,
    /// Target-specific reverse index to traverse.
    pub source_kind: EmailPolicySourceKind,
    /// Changed or deleted contact/company ID, never resolved by name.
    pub source_id: Uuid,
    /// Cursor into raw references, not only currently active policies.
    pub after: Option<EmailPolicySourceReference>,
    /// W3C trace context only.
    pub traceparent: Option<String>,
}

/// Atomic member-scoped storage. No operation here changes contribution mode.
pub trait EmailPolicyTransaction: Send {
    /// Facts locked until commit; the use case applies version CAS to these.
    fn state(&self) -> &EmailPolicyState;
    /// Read a committed result only in the locked incarnation.
    fn idempotency(
        &mut self,
        request_id: Uuid,
    ) -> impl Future<Output = Result<Option<EmailPolicyIdempotency>, CrmError>> + Send;
    /// Insert, never overwrite, a result. False means the key already exists;
    /// the use case must compare its command hash before treating it as a retry.
    fn record_idempotency(
        &mut self,
        result: &NewEmailPolicyIdempotency,
    ) -> impl Future<Output = Result<bool, CrmError>> + Send;
    /// Append immutable history, stamping the locked consent identity/version.
    fn record_audit(
        &mut self,
        entry: &NewEmailPolicyAudit,
    ) -> impl Future<Output = Result<bool, CrmError>> + Send;
    /// Read at most fifty owner-only events, newest first.
    fn audit_page(
        &mut self,
        before: Option<Uuid>,
    ) -> impl Future<Output = Result<Vec<EmailPolicyAudit>, CrmError>> + Send;
    /// Replace the owner's preview slot; an old job cannot update the new slot.
    fn start_preview(
        &mut self,
        preview_id: Uuid,
        context_id: Uuid,
        definition: &EmailRuleSet,
        expires_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;
    /// Read only the exact current job in the locked incarnation/version.
    fn preview(
        &mut self,
        preview_id: Uuid,
    ) -> impl Future<Output = Result<Option<EmailPolicyPreview>, CrmError>> + Send;
    /// Update only a live, unexpired, matching job/context; false is stale work.
    fn checkpoint_preview(
        &mut self,
        preview_id: Uuid,
        generation: EmailPolicyGeneration,
        context_id: Uuid,
        progress: &EmailPolicyPreviewProgress,
    ) -> impl Future<Output = Result<bool, CrmError>> + Send;
    /// Replace the coalesced historical request; a restart rescans unfinished
    /// history rather than losing it when the policy narrows.
    fn request_work(
        &mut self,
        work_id: Uuid,
        traceparent: Option<&str>,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;
    /// Read the generation-bound durable work, independent of its publication.
    fn work(&mut self) -> impl Future<Output = Result<Option<EmailPolicyWork>, CrmError>> + Send;
    /// Checkpoint only the matching request and generation, never rewind it.
    fn checkpoint_work(
        &mut self,
        work_id: Uuid,
        generation: EmailPolicyGeneration,
        after_thread_id: Uuid,
    ) -> impl Future<Output = Result<bool, CrmError>> + Send;
    /// Remove only the matching request and generation; a replacement survives.
    fn complete_work(
        &mut self,
        work_id: Uuid,
        generation: EmailPolicyGeneration,
    ) -> impl Future<Output = Result<bool, CrmError>> + Send;
    /// Commit all metadata together, or roll it back by dropping the transaction.
    fn commit(self) -> impl Future<Output = Result<(), CrmError>> + Send;
}

/// One locked source event for bounded reverse fan-out.
pub trait EmailPolicySourceTransaction: Send {
    /// Claimed event and its persisted cursor.
    fn event(&self) -> &EmailPolicySourceEvent;
    /// Return at most one hundred raw references through the source index.
    fn references(
        &mut self,
    ) -> impl Future<Output = Result<Vec<EmailPolicySourceReference>, CrmError>> + Send;
    /// Advance after the caller durably handled a page, or delete an exhausted
    /// event. The worker owns that durable hand-off.
    fn advance(
        &mut self,
        after: Option<&EmailPolicySourceReference>,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;
    /// Commit progress; dropping the transaction leaves the event retryable.
    fn commit(self) -> impl Future<Output = Result<(), CrmError>> + Send;
}

/// Private policy storage, separate from the legacy privacy API.
pub trait EmailPolicyRepository: Clone + Send + Sync + 'static {
    /// Owner-bound transaction; it cannot be used to operate on another member.
    type Transaction: EmailPolicyTransaction;
    /// Row-locked source event.
    type SourceTransaction: EmailPolicySourceTransaction;
    /// Lock mailbox, membership and consent under the exclusive team privacy
    /// lock. None means missing authority/context; Existing never initializes.
    fn open_email_policy(
        &self,
        team: Uuid,
        user: &str,
        open: OpenEmailPolicy,
    ) -> impl Future<Output = Result<Option<Self::Transaction>, CrmError>> + Send;
    /// Claim one source event with SKIP LOCKED for the bounded worker.
    fn next_email_policy_source_event(
        &self,
    ) -> impl Future<Output = Result<Option<Self::SourceTransaction>, CrmError>> + Send;
}
