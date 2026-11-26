//! Own-member rule authoring. Inspection and validation never change consent.

use super::{
    auth::CrmTeamReceipt,
    email_policy::{EmailPolicyAudit, EmailPolicyTransaction},
    email_rules::{EmailContributionMode, EmailInclusionRule, EmailPolicyActorKind, EmailRuleSet},
    model::CrmError,
};
use entity_access::domain::models::MemberTeamRole;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

/// Rollout controls authoring, never enforcement of a stored restriction.
/// Object-safe because composition injects an `Arc<dyn SelectiveEmailGate>`.
#[async_trait::async_trait]
pub trait SelectiveEmailGate: std::fmt::Debug + Send + Sync {
    /// Missing and failed evaluations refuse new grants.
    async fn enabled_for(&self, user: macro_user_id::user_id::MacroUserIdStr<'_>) -> bool;
}

/// An observed consent state, not an authorization credential. Never refresh
/// this token automatically after a conflict and replay a sharing command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum EmailPolicyToken {
    /// A read-only fingerprint of legacy consent, mailbox and membership.
    Legacy {
        /// Opaque observation; the first write compares it before initialization.
        fingerprint: String,
    },
    /// Identity and version of an initialized consent lifetime.
    Policy {
        /// Never reused after deletion and recreation of consent.
        consent_incarnation: Uuid,
        /// Database-owned version observed by the caller.
        policy_version: i64,
        /// Explicit mailbox and membership authority, excluding sync state.
        authority_fingerprint: String,
    },
}

/// Storage facts read in one snapshot, including a token for legacy state.
#[derive(Debug, Clone)]
pub struct EmailPolicyObservation {
    /// Exact consent mailbox, or the connected primary before first consent.
    pub link_id: Option<Uuid>,
    /// Own mailbox address for contribution controls, never another mailbox.
    pub mailbox_email: Option<String>,
    /// Current stored mode, including a withdrawn selected definition.
    pub mode: EmailContributionMode,
    /// Effective grant bit, independent of permission to view CRM.
    pub enabled: bool,
    /// Present only when an exact mailbox can be observed.
    pub token: Option<EmailPolicyToken>,
    /// Database version, including an uninitialized legacy row.
    pub policy_version: i64,
    /// Explicit mailbox and membership authority used by modern tokens.
    pub authority_fingerprint: String,
    /// Read-only policy-state digest, also used to invalidate preview observations.
    pub fingerprint: String,
    /// Current immutable revision, if any.
    pub revision: Option<i64>,
    /// Current definition, with live IDs rather than expanded identities.
    pub rules: Option<EmailRuleSet>,
}

/// Owner-only view. GET never initializes identity or transfers historical work.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct EmailPolicyView {
    /// Whether new rule authoring is available for this caller.
    pub authoring_available: bool,
    /// Exact mailbox represented by the consent or prospective first grant.
    pub link_id: Option<Uuid>,
    /// The caller's mailbox address.
    pub mailbox_email: Option<String>,
    /// Current scope of contribution.
    pub mode: EmailContributionMode,
    /// Current effective grant.
    pub enabled: bool,
    /// Legacy state has no editable token while rollout is off.
    pub token: Option<EmailPolicyToken>,
    /// Active immutable definition revision.
    pub revision: Option<i64>,
    /// The member's own definition; references continue to resolve live.
    pub rules: Option<EmailRuleSet>,
    /// Explain whole-thread sharing, live targets and overriding exclusions.
    pub effect: String,
}

/// Facts used to authorize a bounded target set, without exposing CRM contents.
#[derive(Debug, Clone, Default)]
pub struct EmailRuleTargetFacts {
    /// Threads in the contributor's exact mailbox.
    pub threads: Vec<Uuid>,
    /// Contacts visible to this member's current role, and whether they match now.
    pub contacts: Vec<(Uuid, bool)>,
    /// Companies visible to this member's current role, and whether they match now.
    pub companies: Vec<(Uuid, bool)>,
}

impl EmailRuleTargetFacts {
    /// Require every referenced object to belong to the authorized mailbox/team
    /// and to be visible to the current member role. Storage repeats this pure
    /// domain check after taking locks when a preview is queued.
    pub(crate) fn validate_references(&self, rules: &[EmailInclusionRule]) -> Result<(), CrmError> {
        for (index, rule) in rules.iter().enumerate() {
            let authorized = match rule {
                EmailInclusionRule::Thread { thread_id } => self.threads.contains(thread_id),
                EmailInclusionRule::Contact { contact_id } => {
                    self.contacts.iter().any(|(id, _)| id == contact_id)
                }
                EmailInclusionRule::Company { company_id } => {
                    self.companies.iter().any(|(id, _)| id == company_id)
                }
                _ => true,
            };
            if !authorized {
                return Err(CrmError::InvalidRequest(format!(
                    "rule {index} does not reference an accessible target in this mailbox or team"
                )));
            }
        }
        Ok(())
    }
}

/// Canonical rules and bounded warnings; validation does not grant contribution.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct EmailRuleValidation {
    /// Normalized, sorted and deduplicated, without expanding live references.
    pub rules: EmailRuleSet,
    /// Indices into the canonical list that currently have no live targets.
    pub inactive_rule_indices: Vec<usize>,
    /// Indices that may select most mail because they match the owner or domain.
    pub broad_rule_indices: Vec<usize>,
    /// Human-readable effect to show before an agent changes sharing.
    pub effect: String,
}

/// One explicit sharing command; member and team never come from the body.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum EmailPolicyChange {
    /// Directly activate a full replacement, including an empty rule list.
    ReplaceRules {
        /// Positive selectors for eligible past and future whole threads.
        rules: EmailRuleSet,
    },
    /// Explicitly share all eligible past and future mail.
    // Empty struct variants preserve serde unknown-field rejection.
    EnableAll {},
    /// Withdraw contribution, retaining CRM records and interaction dates.
    Withdraw {},
}

/// Retry-safe command with the exact state observed by the caller.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EmailPolicyCommand {
    /// State returned by inspection; stale tokens produce a conflict.
    pub if_policy: EmailPolicyToken,
    /// One UUID per intended operation, reused only for its retries.
    pub request_id: Uuid,
    /// The explicit sharing operation.
    pub change: EmailPolicyChange,
}

/// Attribution derived at the authenticated boundary, never deserialized.
#[derive(Debug, Clone)]
pub struct EmailPolicyActor {
    /// Verified provenance, not a caller-supplied claim.
    pub kind: EmailPolicyActorKind,
    /// Signed delegated-agent identity, if present.
    pub agent_id: Option<Uuid>,
    /// Session from the verified request attribution context.
    pub session_id: Option<Uuid>,
    /// Existing scoped-credential sharing policy.
    pub may_share: bool,
}

/// Recorded outcome. A replay describes the original commit, not current state.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct EmailPolicyOutcome {
    /// State token produced by this commit.
    pub token: EmailPolicyToken,
    /// Committed scope.
    pub mode: EmailContributionMode,
    /// Whether this commit granted contribution.
    pub enabled: bool,
    /// Committed definition revision, if selected.
    pub revision: Option<i64>,
    /// Owner history entry identifying this operation.
    pub audit_event_id: Uuid,
    /// True means the stored result was returned without repeating any effects.
    pub replayed: bool,
    /// Sharing and retention effects of the committed operation.
    pub effect: String,
}

/// Owner history has a fixed fifty-event page.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct EmailPolicyHistory {
    /// Audit entries without mailbox contents or expanded source identities.
    pub events: Vec<EmailPolicyAudit>,
    /// Exclusive UUID cursor for the next page.
    pub next_cursor: Option<Uuid>,
}

/// One immutable owner-only definition, fetched separately from history pages.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct EmailPolicyRevision {
    /// Revision in this member's rule history.
    pub revision: i64,
    /// Mailbox the saved definition refers to.
    pub link_id: Uuid,
    /// Stored selectors; no expanded contact details or mail content.
    pub rules: EmailRuleSet,
    /// Time this definition was committed.
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// New mutations share the existing consent transaction and durable envelopes.
pub trait EmailPolicyAuthoringTransaction: EmailPolicyTransaction {
    /// Whether this transaction initialized a matching legacy observation.
    fn initialized_legacy(&self) -> bool;
    /// Version observed before initialization, for retry metadata.
    fn original_policy_version(&self) -> i64;
    /// Authority captured after locking the mailbox and current membership.
    fn authority_fingerprint(&self) -> Option<&str>;
    /// Exact connected primary; absent after lifecycle revocation.
    fn authoring_mailbox(
        &mut self,
    ) -> impl Future<Output = Result<Option<String>, CrmError>> + Send;
    /// Lock referenced parents then contacts, and revalidate after waiting.
    fn lock_rule_targets(
        &mut self,
        rules: &[EmailInclusionRule],
    ) -> impl Future<Output = Result<EmailRuleTargetFacts, CrmError>> + Send;
    /// Admit a replacement against all active selected contributors, in this
    /// locked transaction. Failure must roll back initialization and all effects.
    fn admit_rule_resources(
        &mut self,
        rules: &[EmailInclusionRule],
    ) -> impl Future<Output = Result<(), CrmError>> + Send;
    /// Persist JSON and all five target sets from the same validated definition.
    fn save_rule_revision(
        &mut self,
        rules: &EmailRuleSet,
    ) -> impl Future<Output = Result<i64, CrmError>> + Send;
    /// Change the grant under the locked incarnation. The database owns versioning.
    fn set_policy(
        &mut self,
        change: &EmailPolicyChange,
        revision: Option<i64>,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;
    /// Withdrawal cancels all unfinished history, including legacy outbox work.
    fn cancel_history(&mut self) -> impl Future<Output = Result<(), CrmError>> + Send;
}

/// Storage boundary for owner inspection and first-write initialization.
pub trait EmailPolicyAuthoringRepository: Clone + Send + Sync + 'static {
    /// Consent and mutation metadata share one transaction.
    type Authoring: EmailPolicyAuthoringTransaction;
    /// One read-only snapshot; absent membership is refused.
    fn inspect_email_policy(
        &self,
        team: Uuid,
        user: &str,
    ) -> impl Future<Output = Result<EmailPolicyObservation, CrmError>> + Send;
    /// A legacy token initializes only when it still matches; a modern row may
    /// open for a legacy retry, but only a recorded idempotency result may succeed.
    fn open_email_policy_authoring(
        &self,
        team: Uuid,
        user: &str,
        token: &EmailPolicyToken,
        initialize_legacy: bool,
    ) -> impl Future<Output = Result<Option<Self::Authoring>, CrmError>> + Send;
    /// Side-effect-free bounded validation against the exact owner mailbox.
    fn email_rule_targets(
        &self,
        team: Uuid,
        user: &str,
        link: Uuid,
        rules: &[EmailInclusionRule],
    ) -> impl Future<Output = Result<EmailRuleTargetFacts, CrmError>> + Send;
    /// Read-only resource admission, replacing this member in the team's scope.
    /// Validation is not a reservation; mutation repeats it under the team lock.
    fn admit_email_rule_resources(
        &self,
        team: Uuid,
        user: &str,
        link: Uuid,
        rules: &[EmailInclusionRule],
    ) -> impl Future<Output = Result<(), CrmError>> + Send;
    /// Fetch one owner definition by its full primary key.
    fn email_rule_revision(
        &self,
        team: Uuid,
        user: &str,
        revision: i64,
    ) -> impl Future<Output = Result<Option<EmailPolicyRevision>, CrmError>> + Send;
    /// Read history without initializing consent identity.
    fn email_policy_audit(
        &self,
        team: Uuid,
        user: &str,
        before: Option<Uuid>,
    ) -> impl Future<Output = Result<Vec<EmailPolicyAudit>, CrmError>> + Send;
}

/// Own-member operations remain available independently of CRM viewing access.
pub trait EmailPolicyService: Clone + Send + Sync + 'static {
    /// Read current state; never initialize or migrate on inspection.
    fn email_policy(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
    ) -> impl Future<Output = Result<EmailPolicyView, CrmError>> + Send;
    /// Authorize and canonicalize without changing sharing.
    fn validate_email_rules(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        rules: EmailRuleSet,
    ) -> impl Future<Output = Result<EmailRuleValidation, CrmError>> + Send;
    /// Commit one direct member/agent command atomically with audit and work.
    fn change_email_policy(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        actor: EmailPolicyActor,
        command: EmailPolicyCommand,
    ) -> impl Future<Output = Result<EmailPolicyOutcome, CrmError>> + Send;
    /// Read one immutable definition without expanding live record details.
    fn email_policy_revision(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        revision: i64,
    ) -> impl Future<Output = Result<Option<EmailPolicyRevision>, CrmError>> + Send;
    /// Read only this member's history, including records before initialization.
    fn email_policy_history(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        before: Option<Uuid>,
    ) -> impl Future<Output = Result<EmailPolicyHistory, CrmError>> + Send;
}
