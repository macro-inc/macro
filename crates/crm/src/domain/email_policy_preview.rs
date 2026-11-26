//! Asynchronous own-mailbox counts; previewing never grants or initializes consent.
use super::{
    auth::CrmTeamReceipt,
    email_policy::{EmailPolicyPreviewCounts, EmailPolicyPreviewStatus},
    email_policy_api::EmailPolicyToken,
    email_rules::EmailRuleSet,
    model::CrmError,
};
use chrono::{DateTime, Utc};
use entity_access::domain::models::MemberTeamRole;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

/// A bounded preview request. The slot token fences delayed starts after replacement.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EmailPreviewRequest {
    /// Observed sharing state; never refreshed automatically after a conflict.
    pub if_policy: EmailPolicyToken,
    /// Current preview ID from inspection, or null before the first preview.
    pub if_preview_id: Option<Uuid>,
    /// Hypothetical selected contribution; validation never activates it.
    pub rules: EmailRuleSet,
}

/// Count-only result. Complete counts describe one stable snapshot; every other
/// status is incomplete and must not be presented as the total mailbox count.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct EmailPreviewView {
    /// The member's current preview slot occupant.
    pub preview_id: Uuid,
    /// A new worker attempt gets a new context; old completions cannot overwrite it.
    pub context_id: Uuid,
    /// Pending, running, complete, partial, cancelled or stale.
    pub status: EmailPolicyPreviewStatus,
    /// Distinct counts of this member's mailbox-local threads, never team conversations.
    pub counts: EmailPolicyPreviewCounts,
    /// Time of the stable read snapshot, once a worker starts.
    pub as_of: Option<DateTime<Utc>>,
    /// Enqueue time, used to explain queue delay.
    pub created_at: DateTime<Utc>,
    /// Five-minute work deadline; results remain inspectable after the deadline.
    pub expires_at: DateTime<Utc>,
    /// Progress counts contain no identities, subjects, participants or bodies.
    pub scanned_threads: i64,
}

/// Private durable job; none of its identity fields are accepted from a request.
#[derive(Debug, Clone)]
pub struct EmailPreviewJob {
    /// Current slot and processing attempt.
    pub view: EmailPreviewView,
    /// Authorized contributor's team.
    pub team_id: Uuid,
    /// Contributor, not a teammate whose mail might overlap.
    pub user_id: String,
    /// Exact mailbox to scan.
    pub link_id: Uuid,
    /// Consent observation captured at enqueue, including an uninitialized state.
    pub token: EmailPolicyToken,
    /// Includes membership and mailbox lifecycle state as well as consent.
    pub observed_fingerprint: String,
    /// Bounded hypothetical selected rules, with live references.
    pub rules: EmailRuleSet,
    /// Request trace context only, never mail content.
    pub traceparent: Option<String>,
}

/// Counts for one indexed raw page; missing matches still advance the cursor.
#[derive(Debug, Clone, Default)]
pub struct EmailPreviewPage {
    /// Counts for at most one hundred mailbox-local threads.
    pub counts: EmailPolicyPreviewCounts,
    /// Number of raw threads examined, including drafts and denied threads.
    pub scanned_threads: i64,
}

/// Read-only snapshot retained through the bounded traversal.
pub trait EmailPreviewSnapshot: Send {
    /// Database time when this snapshot was established.
    fn as_of(&self) -> DateTime<Utc>;
    /// Next raw page through the existing mailbox timestamp/id index.
    /// A bounded statement timeout ends an expensive page as partial work.
    fn next_page(
        &mut self,
        timeout_ms: u32,
    ) -> impl Future<Output = Result<EmailPreviewPage, CrmError>> + Send;
}

/// Durable preview storage and isolated read-only counting.
pub trait EmailPreviewRepository: Clone + Send + Sync + 'static {
    /// No sharing row is changed by this read transaction.
    type Snapshot: EmailPreviewSnapshot;
    /// Atomically compare observed policy/slot, reuse exact retries, and enqueue.
    fn start_email_preview(
        &self,
        team: Uuid,
        user: &str,
        input: &EmailPreviewRequest,
    ) -> impl Future<Output = Result<EmailPreviewView, CrmError>> + Send;
    /// Read the current slot; contextual staleness is projected without writes.
    fn email_preview(
        &self,
        team: Uuid,
        user: &str,
    ) -> impl Future<Output = Result<Option<EmailPreviewView>, CrmError>> + Send;
    /// Stop only the named current slot. Cancellation never grants contribution.
    fn cancel_email_preview(
        &self,
        team: Uuid,
        user: &str,
        preview_id: Uuid,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;
    /// Claim one due slot. No row lock survives into the snapshot traversal.
    fn claim_email_preview(
        &self,
    ) -> impl Future<Output = Result<Option<EmailPreviewJob>, CrmError>> + Send;
    /// Reauthorize the captured owner and observation in a new read snapshot.
    fn open_email_preview(
        &self,
        job: &EmailPreviewJob,
    ) -> impl Future<Output = Result<Option<Self::Snapshot>, CrmError>> + Send;
    /// Publish only to the current, uncancelled attempt and recheck authorization.
    fn finish_email_preview(
        &self,
        job: &EmailPreviewJob,
        view: &EmailPreviewView,
    ) -> impl Future<Output = Result<bool, CrmError>> + Send;
    /// Bridge stored W3C context at the outbound observability boundary.
    fn adopt_preview_trace(&self, job: &EmailPreviewJob, span: &tracing::Span);
}

/// Owner-facing preview controls, independent of CRM viewing permission.
pub trait EmailPreviewService: Clone + Send + Sync + 'static {
    /// Start optional bounded counting without changing sharing.
    fn preview_email_rules(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        input: EmailPreviewRequest,
    ) -> impl Future<Output = Result<EmailPreviewView, CrmError>> + Send;
    /// Inspect the current job, including a stale or expired result.
    fn email_rule_preview(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
    ) -> impl Future<Output = Result<Option<EmailPreviewView>, CrmError>> + Send;
    /// Cancel only the member's current named job, including with rollout off.
    fn cancel_email_rule_preview(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        preview_id: Uuid,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;
}

/// Background counting never initializes or activates contribution.
pub trait EmailPreviewWorkService: Clone + Send + Sync + 'static {
    /// At most ten thousand threads, in pages of one hundred, within five minutes.
    /// Idle polls create no span and scan only the preview metadata queue index.
    fn process_email_preview(&self) -> impl Future<Output = Result<bool, CrmError>> + Send;
}
