//! Historical work is a captured grant; a live-mail notification is only a hint.
//! Neither can activate consent. Reconciliation always uses current eligibility.

use super::{email_policy::*, email_privacy::EmailContributionMailbox, model::CrmError};
use chrono::{DateTime, Utc};
use uuid::Uuid;

/// Authorization retained by a historical population operation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EmailHistoryAuthority {
    /// Old queue messages may run only before consent identity is initialized.
    Legacy,
    /// Identity and version captured when modern history was scheduled.
    Policy(EmailPolicyGeneration),
}

/// Exact durable job named by an outbox publication and every continuation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EmailPolicyWorkRequest {
    /// Team whose member granted contribution.
    pub team_id: Uuid,
    /// Contributor, never a viewer or an administrator acting for them.
    pub user_id: String,
    /// Exact consented mailbox.
    pub link_id: Uuid,
    /// Replaceable durable slot occupant.
    pub work_id: Uuid,
    /// Captured grant, never inferred from a received message.
    pub generation: EmailPolicyGeneration,
}

/// Sent-capable contacts are processed first so received-only contacts can then
/// attach to companies those sent contacts created, matching legacy backfill.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EmailPolicyHistoryCursor {
    /// False for the sent-first pass, true for the final all-contact pass.
    pub received_pass: bool,
    /// Last processed raw address; deletion does not invalidate it.
    pub after_contact_address: Option<String>,
}

/// Stored slot, including obsolete versions needed for a safe hand-off.
#[derive(Clone, Debug)]
pub struct EmailPolicyHistoryWork {
    /// Original request, not the current consent's identity.
    pub request: EmailPolicyWorkRequest,
    /// Durable pass and raw-address position.
    pub cursor: EmailPolicyHistoryCursor,
}

/// One raw mailbox contact; empty and ineligible contacts still advance the cursor.
#[derive(Clone, Debug)]
pub struct EmailPolicyHistoryContact {
    /// Address as stored, preserving the index's order and collation.
    pub address: String,
    /// Optional observed name, never logged by the worker.
    pub name: Option<String>,
}

/// A bounded page prepared under the captured consent before releasing locks.
#[derive(Clone, Debug)]
pub struct EmailPolicyHistoryPage {
    /// Own address used to skip self/company correspondence.
    pub mailbox: EmailContributionMailbox,
    /// Compare-and-swap pass/cursor for completion, including the initial NULL.
    pub cursor: EmailPolicyHistoryCursor,
    /// At most one hundred contacts; every effect reauthorizes independently.
    pub contacts: Vec<EmailPolicyHistoryContact>,
}

/// Current eligible dates/direction, determined before enrichment and again at write.
#[derive(Clone, Debug)]
pub struct EmailPolicyInteraction {
    /// Earliest eligible interaction.
    pub first_at: DateTime<Utc>,
    /// Latest eligible interaction.
    pub last_at: DateTime<Utc>,
    /// Whether an eligible sent message permits creating a company.
    pub is_sent: bool,
}

/// One current selected policy found after bounding raw reverse references.
#[derive(Clone, Debug)]
pub struct EmailPolicySourceCandidate {
    /// Member and definition referenced by the event.
    pub reference: EmailPolicySourceReference,
    /// Current lifetime/version, rechecked under the member transaction.
    pub generation: EmailPolicyGeneration,
}

/// Additional operations on the same locked member policy transaction.
pub trait EmailPolicyHistoryTransaction: EmailPolicyTransaction {
    /// Exact, still connected primary mailbox; CRM viewing permission is irrelevant.
    fn history_mailbox(
        &mut self,
    ) -> impl Future<Output = Result<Option<EmailContributionMailbox>, CrmError>> + Send;
    /// Read the slot without substituting the current consent's generation.
    fn history_work(
        &mut self,
    ) -> impl Future<Output = Result<Option<EmailPolicyHistoryWork>, CrmError>> + Send;
    /// Read a raw address page through the existing mailbox/address index.
    fn history_contacts(
        &mut self,
        after: Option<&str>,
    ) -> impl Future<Output = Result<Vec<EmailPolicyHistoryContact>, CrmError>> + Send;
    /// Checkpoint and republish atomically, or retire the exact completed job.
    /// False means a duplicate page or replacement already won.
    fn finish_history_page(
        &mut self,
        request: &EmailPolicyWorkRequest,
        expected: &EmailPolicyHistoryCursor,
        next: Option<&EmailPolicyHistoryCursor>,
    ) -> impl Future<Output = Result<bool, CrmError>> + Send;
}

/// Source event reads stay bounded before current-policy filtering.
pub trait EmailPolicySourceWorkerTransaction: EmailPolicySourceTransaction {
    /// Continue the source edit's persisted tracing context without logging it.
    fn adopt_trace(&self, span: &tracing::Span);
    /// Recheck only the at-most-one-hundred raw references in this page.
    fn source_candidates(
        &mut self,
        references: &[EmailPolicySourceReference],
    ) -> impl Future<Output = Result<Vec<EmailPolicySourceCandidate>, CrmError>> + Send;
}

/// Worker-specific storage; no caller initializes or grants consent.
pub trait EmailPolicyWorkRepository: Clone + Send + Sync + 'static {
    /// Same policy lock order used by member edits.
    type History: EmailPolicyHistoryTransaction;
    /// One source event retained until its bounded hand-off is durable.
    type Source: EmailPolicySourceWorkerTransaction;
    /// Find only the requested incarnation. Missing/replaced consent is terminal.
    fn open_history(
        &self,
        request: &EmailPolicyWorkRequest,
    ) -> impl Future<Output = Result<Option<Self::History>, CrmError>> + Send;
    /// Open a current source reference without creating consent.
    fn open_source_policy(
        &self,
        team: Uuid,
        candidate: &EmailPolicySourceCandidate,
    ) -> impl Future<Output = Result<Option<Self::History>, CrmError>> + Send;
    /// Claim one source event with SKIP LOCKED.
    fn next_source_event(
        &self,
    ) -> impl Future<Output = Result<Option<Self::Source>, CrmError>> + Send;
}

/// Domain use cases exposed to the email worker, separately from member APIs.
pub trait EmailPolicyWorkService: Send + Sync {
    /// Legacy history cannot adopt initialized consent, even when it is all-mail.
    fn legacy_history_mailbox(
        &self,
        team: Uuid,
        user: &str,
    ) -> impl Future<Output = Result<Option<EmailContributionMailbox>, CrmError>> + Send;
    /// Reauthorize and read a bounded page, or transfer same-lifetime stale work.
    fn history_page(
        &self,
        request: &EmailPolicyWorkRequest,
    ) -> impl Future<Output = Result<Option<EmailPolicyHistoryPage>, CrmError>> + Send;
    /// Reauthorize a historical effect before enrichment and inside its transaction.
    #[expect(
        clippy::too_many_arguments,
        reason = "historical population retains the exact mailbox, contact and grant at the port boundary"
    )]
    fn populate_history_contact(
        &self,
        team: Uuid,
        link: Uuid,
        user_email: &str,
        email: &str,
        name: Option<&str>,
        authority: EmailHistoryAuthority,
        sent_only: bool,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;
    /// Checkpoint only after every page effect succeeded; obsolete jobs never ack replacements.
    fn finish_history_page(
        &self,
        request: &EmailPolicyWorkRequest,
        page: &EmailPolicyHistoryPage,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;
    /// Hand off one bounded reverse-reference page; false means no event was due.
    fn reconcile_source_page(&self) -> impl Future<Output = Result<bool, CrmError>> + Send;
}

/// Historical population reuses the existing ingestion queries with a retained grant.
pub trait EmailHistoryPopulationRepository: Send + Sync {
    /// Legacy jobs never acquire an initialized consent's identity.
    fn legacy_history_mailbox(
        &self,
        team: Uuid,
        user: &str,
    ) -> impl Future<Output = Result<Option<EmailContributionMailbox>, CrmError>> + Send;
    /// Check eligible history and the captured authority before any enrichment.
    fn history_interactions(
        &self,
        team: Uuid,
        link: Uuid,
        email: &str,
        authority: EmailHistoryAuthority,
    ) -> impl Future<Output = Result<Option<EmailPolicyInteraction>, CrmError>> + Send;
    /// Repeat authority/eligibility in the existing population transaction.
    #[expect(
        clippy::too_many_arguments,
        reason = "historical population retains the exact mailbox, contact and grant at the port boundary"
    )]
    fn populate_history_contact(
        &self,
        team: Uuid,
        link: Uuid,
        domain: &str,
        email: &str,
        name: Option<&str>,
        personal: bool,
        authority: EmailHistoryAuthority,
        interaction: &EmailPolicyInteraction,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;
}
