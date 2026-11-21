//! CRM access is independent of permission to contribute a mailbox.

#[cfg(any(test, feature = "outbound"))]
pub(crate) mod mailbox_domains;

use entity_access::domain::models::MemberTeamRole;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use super::{
    auth::CrmTeamReceipt,
    model::{CrmError, MailboxDomainConflict},
};

/// Rollout availability for thread-exclusion writes, independent of authorization.
/// `async_trait` allows the service to inject this port through `Arc<dyn ThreadExclusionGate>`.
#[async_trait::async_trait]
pub trait ThreadExclusionGate: std::fmt::Debug + Send + Sync {
    /// Missing or unavailable flag evaluation must return false.
    async fn enabled_for(&self, caller: macro_user_id::user_id::MacroUserIdStr<'_>) -> bool;
}

/// The audience affected by a domain exclusion.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmailBlockScope {
    /// All contributions to the team CRM.
    Team,
    /// Only contributions from the acting user's mailbox.
    Personal,
}

/// Current consent and exclusions, readable by any team member.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct EmailPrivacySettings {
    /// Whether this exact mailbox has explicit contribution consent.
    pub enabled: bool,
    /// The primary mailbox that would contribute; absent before email connection.
    pub mailbox_email: Option<String>,
    /// Exact current primary connection; clients bind opt-in to this identifier.
    pub mailbox_link_id: Option<Uuid>,
    /// Domains excluded across the team, including legacy company exclusions.
    pub team_domains: Vec<String>,
    /// Domains excluded only for the caller's contributions.
    pub personal_domains: Vec<String>,
    /// Existing team exclusions that cover a connected member's whole mailbox.
    pub team_domain_warnings: std::collections::BTreeMap<String, MailboxDomainConflict>,
    /// Existing personal exclusions that cover the caller's whole mailbox.
    pub personal_domain_warnings: std::collections::BTreeMap<String, MailboxDomainConflict>,
    /// Whether the caller can remove a team exclusion.
    pub can_remove_team_domains: bool,
}

/// Current mailbox consent without loading domain exclusion lists.
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EmailContributionConsent {
    /// Whether this exact mailbox has explicit contribution consent.
    pub enabled: bool,
    /// The primary mailbox that would contribute, if connected.
    pub mailbox_email: Option<String>,
    /// Exact current primary mailbox connection.
    pub mailbox_link_id: Option<Uuid>,
}

/// An explicitly consented primary mailbox for a current team member.
#[derive(Debug, Clone)]
pub struct EmailContributionMailbox {
    /// The exact email account covered by consent.
    pub link_id: Uuid,
    /// The connected mailbox address.
    pub email_address: String,
}

/// One private thread from the caller's own mailbox, never a teammate's copy.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ExcludedEmailThread {
    /// Mailbox-local thread identity.
    pub thread_id: Uuid,
    /// Exact mailbox containing this copy.
    pub link_id: Uuid,
    /// Current subject, for the owner's privacy settings.
    pub subject: Option<String>,
}

/// A bounded page of the caller's private threads, ordered by thread ID.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ExcludedEmailThreads {
    /// At most fifty exclusions.
    pub threads: Vec<ExcludedEmailThread>,
    /// Pass as `after` to read the next page.
    pub next_cursor: Option<Uuid>,
}

/// One explicit privacy change, avoiding lost updates to whole blocklists.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum EmailPrivacyChange {
    /// Hold back or restore only the caller's contribution of one thread.
    SetThreadExclusion {
        /// Must belong to a mailbox owned by the authenticated member.
        thread_id: Uuid,
        /// False removes this exception; consent and other exclusions still apply.
        excluded: bool,
    },
    /// Consent covers all available past and future emails in the primary mailbox.
    SetConsent {
        /// False withdraws this mailbox's CRM contribution without deleting records.
        enabled: bool,
        /// Required when enabling; must match the displayed primary connection.
        link_id: Option<Uuid>,
    },
    /// Add a domain and its subdomains to an exclusion list.
    AddDomain {
        /// Which contributions the exclusion affects.
        scope: EmailBlockScope,
        /// Bare company domain.
        domain: String,
    },
    /// Remove an exclusion; other exclusions still apply.
    RemoveDomain {
        /// Which list to edit.
        scope: EmailBlockScope,
        /// Bare company domain.
        domain: String,
    },
}

/// Persistence of consent and blocklists. Writes also schedule eligible backfill.
pub trait EmailPrivacyRepository: Clone + Send + Sync + 'static {
    /// Read only this member's mailbox consent, without domain lists.
    fn email_consent(
        &self,
        team: Uuid,
        user: &str,
    ) -> impl Future<Output = Result<EmailContributionConsent, CrmError>> + Send;

    /// List only this member's exclusions, with an exclusive thread-ID cursor.
    fn excluded_email_threads(
        &self,
        team: Uuid,
        user: &str,
        after: Option<Uuid>,
        thread_id: Option<uuid::Uuid>,
    ) -> impl Future<Output = Result<ExcludedEmailThreads, CrmError>> + Send;

    /// Return a mailbox only when primary, currently in the team, and consented.
    fn contribution_mailbox(
        &self,
        team: Uuid,
        user: &str,
    ) -> impl Future<Output = Result<Option<EmailContributionMailbox>, CrmError>> + Send;

    /// Read only the caller's personal settings and the team's shared list.
    fn email_privacy(
        &self,
        team: Uuid,
        user: &str,
    ) -> impl Future<Output = Result<EmailPrivacySettings, CrmError>> + Send;

    /// Persist a change atomically with its backfill request. Thread changes
    /// must verify mailbox ownership by this member within that transaction.
    /// Domain additions must apply the domain mailbox guard to current primary
    /// connected mailboxes in the affected scope before writing.
    fn change_email_privacy(
        &self,
        team: Uuid,
        user: &str,
        change: EmailPrivacyChange,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;

    /// Admission check before metadata enrichment or contact ingestion:
    /// mailbox, membership, consent and the contact's domain. It reads no
    /// message history; population checks eligible history in its own
    /// transaction.
    fn may_contribute_contact(
        &self,
        team: Uuid,
        link: Uuid,
        email: &str,
    ) -> impl Future<Output = Result<bool, CrmError>> + Send;
}

/// Authorized user-facing privacy operations.
pub trait EmailPrivacyService: Clone + Send + Sync + 'static {
    /// Read only the authenticated member's mailbox consent.
    fn email_consent(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
    ) -> impl Future<Output = Result<EmailContributionConsent, CrmError>> + Send;

    /// List the authenticated mailbox owner's private threads.
    fn excluded_email_threads(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        after: Option<Uuid>,
        thread_id: Option<uuid::Uuid>,
    ) -> impl Future<Output = Result<ExcludedEmailThreads, CrmError>> + Send;

    /// Trusted background workers must resolve consent before historical fan-out.
    fn contribution_mailbox(
        &self,
        team: Uuid,
        user: &str,
    ) -> impl Future<Output = Result<Option<EmailContributionMailbox>, CrmError>> + Send;

    /// Read the caller's contribution state.
    fn email_privacy(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
    ) -> impl Future<Output = Result<EmailPrivacySettings, CrmError>> + Send;

    /// Members may add team blocks; only team admins/owners may remove them.
    fn change_email_privacy(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        change: EmailPrivacyChange,
    ) -> impl Future<Output = Result<EmailPrivacySettings, CrmError>> + Send;
}
