//! Domain models for CRM companies and their related records.

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde_json::Value;

/// A [`CrmCompany`] bundled with display metadata resolved from
/// `crm_domain_directory` against the primary (earliest-created) domain.
/// `name` / `description` are `None` when no directory row exists or
/// the row is in negative-cache state (NULL fields).
#[derive(Debug, Clone)]
pub struct CrmCompanyForSoup {
    /// The underlying company record.
    pub company: CrmCompany,
    /// Display name: the team-scoped `crm_companies.custom_name` override when
    /// set (manual creation), otherwise the primary domain's directory
    /// entry.
    pub name: Option<String>,
    /// Display description from the primary domain's directory entry.
    pub description: Option<String>,
    /// When the requesting user last viewed this company
    /// (`UserHistory.updatedAt`), or `None` if never viewed. Drives the
    /// soup `viewed_at` / `viewed_updated` sorts and the recently-viewed
    /// feed. `None` for sources that don't resolve view history (search).
    pub viewed_at: Option<DateTime<Utc>>,
}

/// A [`CrmCompany`] bundled with its directory display metadata
/// (same as [`CrmCompanyForSoup`]) plus its full contact list — the
/// shape returned by `GET /crm/companies/{company_id}`. Lets the FE
/// hydrate the company panel in a single round trip instead of
/// composing a soup call with a follow-up contacts call.
#[derive(Debug, Clone)]
pub struct CrmCompanyWithContacts {
    /// The underlying company record (with domains pre-populated).
    pub company: CrmCompany,
    /// Display name: the team-scoped `crm_companies.custom_name` override when
    /// set (manual creation), otherwise the primary domain's directory
    /// entry.
    pub name: Option<String>,
    /// Display description from the primary domain's directory entry.
    pub description: Option<String>,
    /// Contacts attached to this company, subject to the caller's
    /// `include_hidden` flag (non-admins get only visible contacts).
    pub contacts: Vec<CrmContact>,
}

/// A known external company tracked by a team (CRM-style record). A company
/// aggregates zero or more email domains and individual contacts that are
/// considered to belong to the same external party.
///
/// Company display metadata (name, description, icon) lives in
/// `crm_domain_directory` keyed by domain — look it up via
/// [`DomainMetadata`] when needed. Manually created companies may
/// additionally carry a team-scoped `crm_companies.custom_name` override that
/// read paths COALESCE over the directory name.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CrmCompany {
    /// The id of the company
    pub id: uuid::Uuid,
    /// The id of the team that owns this company record
    pub team_id: uuid::Uuid,
    /// Whether email sync is enabled for this company
    pub email_sync: bool,
    /// Whether the company is hidden from CRM listings for the owning
    /// team. Display-only opt-out; setting it to `true` also forces
    /// `email_sync = false` (see
    /// [`crate::domain::service::CrmService::set_company_hidden`]).
    pub hidden: bool,
    /// Earliest known email interaction with this company. Repository
    /// read paths fill this from `crm_companies.first_interaction`, not
    /// the row's lifecycle `created_at`.
    pub created_at: DateTime<Utc>,
    /// Most recent known email interaction with this company. Repository
    /// read paths fill this from `crm_companies.last_interaction`, not
    /// the row's lifecycle `updated_at`.
    pub updated_at: DateTime<Utc>,
    /// All domains associated with this company
    pub domains: Vec<CrmDomain>,
}

/// Cached metadata about a company keyed on its email domain. Resolved
/// by [`CompanyMetadataResolver`] and stored in `crm_domain_directory`.
///
/// Every scalar is `Option` and every list defaults empty: the resolver
/// may succeed with little data, including an all-empty negative-cache row.
/// Unavailable results stay pending for a bounded retry instead.
///
/// [`CompanyMetadataResolver`]: crate::domain::company_metadata_resolver::CompanyMetadataResolver
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DomainMetadata {
    /// Company display name.
    pub name: Option<String>,
    /// Short company description.
    pub description: Option<String>,
    /// Logo / icon URL.
    pub icon_url: Option<String>,
    /// Historical Apollo organization id retained for stored-data compatibility.
    pub apollo_organization_id: Option<String>,
    /// Canonical company website.
    pub website_url: Option<String>,
    /// LinkedIn company URL.
    pub linkedin_url: Option<String>,
    /// Twitter / X URL.
    pub twitter_url: Option<String>,
    /// Facebook URL.
    pub facebook_url: Option<String>,
    /// Primary industry.
    pub industry: Option<String>,
    /// Free-text keywords / tags.
    pub keywords: Vec<String>,
    /// Detected technologies.
    pub technologies: Vec<String>,
    /// Estimated headcount.
    pub estimated_num_employees: Option<i32>,
    /// Estimated annual revenue, in dollars.
    pub annual_revenue: Option<i64>,
    /// Human-readable annual revenue (e.g. "100M").
    pub annual_revenue_printed: Option<String>,
    /// Total funding raised, in dollars.
    pub total_funding: Option<i64>,
    /// Human-readable total funding (e.g. "251.2M").
    pub total_funding_printed: Option<String>,
    /// Latest funding stage (e.g. "Series D").
    pub latest_funding_stage: Option<String>,
    /// Date of the latest funding round.
    pub latest_funding_round_date: Option<DateTime<Utc>>,
    /// Year the company was founded.
    pub founded_year: Option<i32>,
    /// Ticker symbol if publicly traded.
    pub publicly_traded_symbol: Option<String>,
    /// Exchange if publicly traded.
    pub publicly_traded_exchange: Option<String>,
    /// Company phone number.
    pub phone: Option<String>,
    /// Full formatted HQ address.
    pub raw_address: Option<String>,
    /// HQ street address.
    pub street_address: Option<String>,
    /// HQ city.
    pub city: Option<String>,
    /// HQ state / region.
    pub state: Option<String>,
    /// HQ postal code.
    pub postal_code: Option<String>,
    /// HQ country.
    pub country: Option<String>,
    /// Historical provider payload retained alongside the modeled metadata.
    pub raw: Option<Value>,
}

/// A domain (e.g. "acme.com") associated with a [`CrmCompany`]. A company
/// may have many domains.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CrmDomain {
    /// The id of the domain record
    pub id: uuid::Uuid,
    /// The id of the company the domain belongs to
    pub company_id: uuid::Uuid,
    /// The domain (e.g. "acme.com"). Stored lowercased.
    pub domain: String,
    /// When the domain record was created
    pub created_at: DateTime<Utc>,
}

/// A contact (individual external party) belonging to a [`CrmCompany`].
/// Tracked per `(company_id, email)`; `name` is the first non-NULL display
/// name observed across the team's populates.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CrmContact {
    /// The id of the contact record
    pub id: uuid::Uuid,
    /// The id of the company the contact belongs to; `None` for a
    /// contact without a company
    pub company_id: Option<uuid::Uuid>,
    /// The contact's email address; `None` for a manually created
    /// contact added by name alone
    pub email: Option<String>,
    /// Display name observed for the contact, if any
    pub name: Option<String>,
    /// Whether the contact is hidden from CRM listings for the owning
    /// team. Set via [`crate::domain::service::CrmService::set_contact_hidden`]
    /// (individual hide) or cascaded from a company-level hide.
    pub hidden: bool,
    /// Earliest known interaction with this contact
    pub first_interaction: DateTime<Utc>,
    /// Most recent known interaction with this contact
    pub last_interaction: DateTime<Utc>,
    /// When the contact record was created
    pub created_at: DateTime<Utc>,
    /// When the contact record was last updated
    pub updated_at: DateTime<Utc>,
    /// Every address the contact is known by, lowercased: the primary
    /// (`email`) first, then the rest oldest first
    pub emails: Vec<String>,
    /// The addresses on a domain of the contact's company. A contact with
    /// any is a company-domain contact: it cannot be unlinked or moved, and
    /// the last of these addresses cannot be removed
    pub company_domain_emails: Vec<String>,
}

/// Which of a company's contacts one page of its Team list holds.
#[derive(Debug, Clone)]
pub struct CrmCompanyContactsQuery {
    /// The archived contacts instead of the visible ones. Under an archived
    /// company every contact is archived.
    pub archived: bool,
    /// Text the contact's name or primary email must contain,
    /// case-insensitively. Empty matches every contact.
    pub search: String,
    /// Where the previous page stopped; `None` for the first page.
    pub cursor: Option<CrmCompanyContactsCursor>,
    /// The most contacts the page holds.
    pub limit: i64,
}

/// The last contact of a Team list page, in the list's order: by
/// lowercased name (the email when unnamed), then by id descending. It is
/// bound to the list it came from: a cursor replayed on another company,
/// archive state or search is refused instead of starting mid-list.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct CrmCompanyContactsCursor {
    /// The contact's lowercased name, or email when it has no name.
    pub sort_name: Option<String>,
    /// The contact's id.
    pub id: uuid::Uuid,
    /// The company whose list the cursor continues.
    pub company_id: uuid::Uuid,
    /// The archive state of that list.
    pub archived: bool,
    /// [`CrmCompanyContactsCursor::search_fingerprint`] of that list's
    /// trimmed search.
    pub search: String,
}

impl CrmCompanyContactsCursor {
    /// A cursor after the contact `(sort_name, id)` of `company_id`'s list
    /// for `query`, whose search is already trimmed.
    pub fn after(
        company_id: uuid::Uuid,
        query: &CrmCompanyContactsQuery,
        sort_name: Option<String>,
        id: uuid::Uuid,
    ) -> Self {
        Self {
            sort_name,
            id,
            company_id,
            archived: query.archived,
            search: Self::search_fingerprint(&query.search),
        }
    }

    /// Whether the cursor continues `company_id`'s list for `query`, whose
    /// search is already trimmed.
    pub fn continues(&self, company_id: uuid::Uuid, query: &CrmCompanyContactsQuery) -> bool {
        self.company_id == company_id
            && self.archived == query.archived
            && self.search == Self::search_fingerprint(&query.search)
    }

    /// A stable digest of the search text (the first 16 bytes of its
    /// SHA-256, in hex), so the cursor doesn't carry the search itself.
    fn search_fingerprint(search: &str) -> String {
        use sha2::{Digest, Sha256};
        Sha256::digest(search.as_bytes())
            .iter()
            .take(16)
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }
}

/// One page of a company's Team list.
#[derive(Debug, Clone)]
pub struct CrmCompanyContactsPage {
    /// The page's contacts, in the list's order.
    pub contacts: Vec<CrmContact>,
    /// Where the next page starts; `None` on the last page.
    pub next_cursor: Option<CrmCompanyContactsCursor>,
}

/// The name and visibility of a contact's company, which the contact's page
/// shows without reading the whole company.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct CrmCompanySummary {
    /// The id of the company
    pub id: uuid::Uuid,
    /// The team's name for the company, else its primary domain's
    /// directory name, as the company read resolves it
    pub name: Option<String>,
    /// The company's oldest domain, which stands in for a missing name
    pub domain: Option<String>,
    /// Whether the company is hidden for the owning team
    pub hidden: bool,
}

/// A contact with a summary of its company.
#[derive(Debug, Clone)]
pub struct CrmContactDetail {
    /// The contact
    pub contact: CrmContact,
    /// Its company; `None` for a contact without one, or one the caller
    /// may not see
    pub company: Option<CrmCompanySummary>,
}

/// What a depopulate teardown actually removed. Every field is `false` on
/// the no-op paths (unknown contact, malformed email), so
/// [`Self::removed_anything`] distinguishes a real teardown from a call
/// that found nothing to do — the cleanup job logs on that basis.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DepopulateContactOutcome {
    /// The `crm_contact_sources` row for this `(contact, link)` was deleted.
    pub source_deleted: bool,
    /// The `crm_contacts` row was deleted: no sibling source rows remained
    /// and the contact was not `manually_created`.
    pub contact_deleted: bool,
    /// The `crm_companies` row was deleted (cascading to `crm_domains`): no
    /// sibling contacts remained and the company was neither killswitched
    /// (`email_sync = false`) nor `manually_created`.
    pub company_deleted: bool,
}

impl DepopulateContactOutcome {
    /// Whether the teardown deleted any row at all.
    pub fn removed_anything(&self) -> bool {
        self.source_deleted || self.contact_deleted || self.company_deleted
    }
}

/// Result of [`crate::domain::companies_repo::CompaniesRepository::crm_scope_precheck`].
///
/// Carries the per-input authorization status the caller (`EmailService`)
/// needs to either accept or reject a CRM-scoped query before it runs.
#[derive(Debug, Clone)]
pub struct CrmScopePrecheck {
    /// Compatibility field, always true for current CRM record scopes.
    /// Email eligibility is checked separately for every candidate thread.
    pub crm_enabled: bool,
    /// One row per requested domain, in the same order as the input list.
    pub domains: Vec<CrmDomainStatus>,
    /// One row per requested address, in the same order as the input
    /// list.
    pub addresses: Vec<CrmAddressStatus>,
}

/// Per-domain authorization status. See [`CrmScopePrecheck`].
#[derive(Debug, Clone)]
pub struct CrmDomainStatus {
    /// The domain as supplied (lowercased).
    pub domain: String,
    /// Whether a `crm_domains` row exists for this `(team_id, domain)`.
    pub exists: bool,
    /// `crm_companies.hidden` for the company owning the matched
    /// `crm_domains` row. `false` when `!exists`.
    pub company_hidden: bool,
    /// `crm_companies.email_sync` for the company owning the matched
    /// `crm_domains` row. `false` when `!exists`.
    pub email_sync: bool,
}

/// Per-address authorization status. See [`CrmScopePrecheck`].
#[derive(Debug, Clone)]
pub struct CrmAddressStatus {
    /// The address as supplied (lowercased).
    pub address: String,
    /// Whether a `crm_contacts` row exists whose company belongs to the
    /// requesting team. Cross-team contacts (same email under a different
    /// team's company) are reported as `exists = false` so existence
    /// doesn't leak across teams.
    pub exists: bool,
    /// Whether any matching team contact is hidden. `false` when `!exists`.
    pub contact_hidden: bool,
    /// Whether any matching contact's company is hidden. `false` when `!exists`.
    pub company_hidden: bool,
    /// Whether every matching contact's company enables email sync. `false` when `!exists`.
    pub email_sync: bool,
}

/// Minimum team role required for a CRM governance capability. Members
/// can edit visible CRM records (e.g. company properties), but the
/// governance capabilities these settings gate stay restricted to
/// admin (default) vs owner. Maps to the `team_role` Postgres enum;
/// `member` is deliberately not representable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "outbound", derive(sqlx::Type))]
#[cfg_attr(
    feature = "outbound",
    sqlx(type_name = "team_role", rename_all = "lowercase")
)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub enum CrmPermissionRole {
    /// Team admins and owners.
    Admin,
    /// Team owners only.
    Owner,
}

impl CrmPermissionRole {
    /// The `team_role` enum literal for SQL binds (queries bind text and
    /// cast with `::team_role`).
    pub fn as_db_str(&self) -> &'static str {
        match self {
            CrmPermissionRole::Admin => "admin",
            CrmPermissionRole::Owner => "owner",
        }
    }
}

/// Team-level CRM configuration stored on `team_crm_settings`
/// (excluding the retired `crm_enabled` flag owned by the teams crate).
#[derive(Debug, Clone)]
pub struct CrmTeamSettings {
    /// Who can change the deal stage set in CRM settings.
    pub edit_stages_role: CrmPermissionRole,
    /// Who can move deals out of a closed stage.
    pub move_closed_deals_role: CrmPermissionRole,
    /// Who can delete (hide) CRM records.
    pub delete_records_role: CrmPermissionRole,
    /// Stage option ids counting as closed deals; `None` = the client
    /// falls back to its label heuristic.
    pub closed_stage_ids: Option<Vec<uuid::Uuid>>,
    /// System stage option id to team stage option id for seeded stages.
    /// Entries may outlive their stage; readers check membership in the set.
    pub legacy_stage_ids: BTreeMap<uuid::Uuid, uuid::Uuid>,
    /// Team saved views — an opaque JSON array owned by the frontend.
    pub team_views: Value,
    /// Team view applied by default when a member opens the CRM view.
    pub default_team_view_id: Option<String>,
    /// Whether email sync keeps personal-provider addresses (gmail.com
    /// etc.) out of the CRM. When off, sync files them as contacts
    /// without a company.
    pub exclude_personal_emails: bool,
}

impl Default for CrmTeamSettings {
    fn default() -> Self {
        Self {
            edit_stages_role: CrmPermissionRole::Admin,
            move_closed_deals_role: CrmPermissionRole::Admin,
            delete_records_role: CrmPermissionRole::Admin,
            closed_stage_ids: None,
            legacy_stage_ids: BTreeMap::new(),
            team_views: Value::Array(Vec::new()),
            default_team_view_id: None,
            exclude_personal_emails: true,
        }
    }
}

/// A domain a team keeps out of email sync.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CrmBlockedDomain {
    /// The blocked domain, lowercase.
    pub domain: String,
    /// When it was added.
    pub created_at: DateTime<Utc>,
}

/// Field-wise partial update of [`CrmTeamSettings`]. Outer `None` =
/// leave the column unchanged; for the two nullable columns the inner
/// `None` clears the value. `team_views` is replaced whole (last-wins).
#[derive(Debug, Clone, Default)]
pub struct CrmTeamSettingsPatch {
    /// New `edit_stages_role`, if provided.
    pub edit_stages_role: Option<CrmPermissionRole>,
    /// New `move_closed_deals_role`, if provided.
    pub move_closed_deals_role: Option<CrmPermissionRole>,
    /// New `delete_records_role`, if provided.
    pub delete_records_role: Option<CrmPermissionRole>,
    /// New `closed_stage_ids`; `Some(None)` clears to the heuristic.
    pub closed_stage_ids: Option<Option<Vec<uuid::Uuid>>>,
    /// Replacement `legacy_stage_ids` map.
    pub legacy_stage_ids: Option<BTreeMap<uuid::Uuid, uuid::Uuid>>,
    /// Replacement `team_views` array.
    pub team_views: Option<Value>,
    /// New `default_team_view_id`; `Some(None)` clears it.
    pub default_team_view_id: Option<Option<String>>,
    /// New `exclude_personal_emails`, if provided.
    pub exclude_personal_emails: Option<bool>,
}

/// Why a domain exclusion would hide an affected mailbox's entire history.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, thiserror::Error)]
#[cfg_attr(feature = "ports", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum MailboxDomainConflict {
    /// A company mailbox already excludes colleagues on its own domain.
    #[error(
        "Colleagues on a mailbox's own company domain are already kept out of the CRM. Blocking this domain would hide all of that mailbox's email."
    )]
    Company,
    /// A shared personal provider is not a company domain.
    #[error("Blocking this domain would hide all of a connected mailbox's email from the CRM.")]
    PersonalProvider,
}

/// Errors that can occur in the CRM domain.
#[derive(Debug, thiserror::Error)]
pub enum CrmError {
    /// The caller's team membership does not permit CRM access.
    #[error("CRM access is not enabled for this team member")]
    AccessDenied,
    /// Storage layer error
    #[error("Storage layer error {0}")]
    StorageLayerError(#[from] anyhow::Error),
    /// Company id is not owned by the requesting team.
    #[error("crm company not found for team")]
    CompanyNotFoundForTeam,
    /// Contact id is not owned by the requesting team.
    #[error("crm contact not found for team")]
    ContactNotFoundForTeam,
    /// Request rejected for a client-side reason (e.g. blank comment text).
    #[error("{0}")]
    InvalidRequest(String),
    /// A domain exclusion would veto every thread in an affected mailbox.
    #[error("{0}")]
    BlocksConnectedMailbox(MailboxDomainConflict),
    /// The request asks for hidden CRM rows but the caller's team role is
    /// below admin/owner.
    #[error("Querying hidden CRM companies requires admin/owner team role")]
    AdminRoleRequired,
    /// The request changes governance fields of the team CRM settings
    /// (permission thresholds, closed stages, or team email exclusions), but the caller's team role
    /// is below admin/owner.
    #[error("changing CRM admin settings requires admin/owner team role")]
    SettingsAdminRequired,
    /// The thread-exclusion rollout is disabled or its flag could not be loaded.
    #[error("thread exclusions are not available")]
    ThreadExclusionsUnavailable,
    /// New policy authoring is disabled or the flag failed to load.
    #[error("selective email contribution is not available")]
    SelectiveEmailUnavailable,
    /// The observed consent lifetime/version or retry command no longer matches.
    #[error("email contribution changed; inspect the current policy before retrying")]
    EmailPolicyConflict,
    /// A scoped credential is not permitted to change sharing.
    #[error("this credential cannot enable email contribution")]
    EmailPolicySharingRefused,
    /// Preview work is limited to one new request per member per thirty seconds.
    #[error("wait before starting another email contribution preview")]
    EmailPreviewRateLimited,
    /// Complete live rule discovery exceeded an authoring/read resource limit.
    #[cfg(feature = "ports")]
    #[error(transparent)]
    EmailRuleLimitExceeded(#[from] super::email_rule_discovery::EmailRuleLimitExceeded),
    /// A count page reached its bounded statement/work budget.
    #[error("email contribution preview reached its work budget")]
    EmailPreviewBudgetExhausted,
    /// Caller's team role is below the team's `edit_stages_role`.
    #[error("editing deal stages requires the {} team role", .0.as_db_str())]
    StageEditRoleRequired(CrmPermissionRole),
    /// Tried to mutate a CRM company in a way that contradicts its
    /// `hidden = true` state, including enabling sync or changing a
    /// contact relation in a way that would reveal an archived record.
    #[error("crm company is hidden")]
    CompanyHidden,
    /// The team already tracks a company for the requested domain.
    #[error("a crm company already exists for this domain")]
    CompanyAlreadyExistsForTeam,
    /// The company already has a contact with the requested email.
    #[error("a crm contact with this email already exists for the company")]
    ContactAlreadyExistsForCompany,
    /// Another visible contact in the owning team already uses this address.
    #[error("a crm contact with this email already exists for the team")]
    ContactAlreadyExistsForTeam,
    /// The team no longer exists.
    #[error("crm is unavailable for this team")]
    CrmDisabledForTeam,
    /// Entity access receipt did not contain a valid team UUID.
    #[error("invalid team id in entity access receipt")]
    InvalidTeamId,
    /// A concurrent write invalidated this population's history evidence or
    /// held needed records for too long. Nothing was written; retry later.
    #[error("crm records are busy; retry later")]
    Contended,
}

/// Contact fields plus the owning team/company and the viewer's history.
#[derive(Debug, Clone)]
pub struct CrmContactForSoup {
    /// The original team-owned contact; its identity is never merged.
    pub contact: CrmContact,
    /// Team owning the company/contact record.
    pub team_id: uuid::Uuid,
    /// The company's display name (team override, directory name, or
    /// domain); `None` for a contact without a company.
    pub company_name: Option<String>,
    /// When this viewer last opened this particular contact record.
    pub viewed_at: Option<DateTime<Utc>>,
}
