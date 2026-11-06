//! CRM access is independent of permission to contribute a mailbox.

use entity_access::domain::models::MemberTeamRole;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use super::{auth::CrmTeamReceipt, model::CrmError};

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
    /// Whether the caller can remove a team exclusion.
    pub can_remove_team_domains: bool,
}

/// An explicitly consented primary mailbox for a current team member.
#[derive(Debug, Clone)]
pub struct EmailContributionMailbox {
    /// The exact email account covered by consent.
    pub link_id: Uuid,
    /// The connected mailbox address.
    pub email_address: String,
}

/// One explicit privacy change, avoiding lost updates to whole blocklists.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum EmailPrivacyChange {
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

    /// Persist a validated, authorized change atomically with its backfill request.
    fn change_email_privacy(
        &self,
        team: Uuid,
        user: &str,
        change: EmailPrivacyChange,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;

    /// Admission check before metadata enrichment or contact ingestion.
    fn may_contribute_contact(
        &self,
        team: Uuid,
        link: Uuid,
        email: &str,
    ) -> impl Future<Output = Result<bool, CrmError>> + Send;
}

/// Authorized user-facing privacy operations.
pub trait EmailPrivacyService: Clone + Send + Sync + 'static {
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
