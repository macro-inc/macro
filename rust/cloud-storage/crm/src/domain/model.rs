//! Domain models for CRM companies and their related records.

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
    /// Display name from the primary domain's directory entry.
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
    /// Display name from the primary domain's directory entry.
    pub name: Option<String>,
    /// Display description from the primary domain's directory entry.
    pub description: Option<String>,
    /// Contacts attached to this company, subject to the caller's
    /// `include_hidden` flag (non-admins get only visible contacts).
    pub contacts: Vec<CrmContact>,
}

/// A known external company tracked by a team (CRM-style record). A company
/// aggregates one or more email domains and individual contacts that are
/// considered to belong to the same external party.
///
/// Company display metadata (name, description, icon) lives in
/// `crm_domain_directory` keyed by domain, not on `crm_companies` —
/// look it up via [`DomainMetadata`] when needed.
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
    /// When the company was created
    pub created_at: DateTime<Utc>,
    /// When the company was last updated
    pub updated_at: DateTime<Utc>,
    /// All domains associated with this company
    pub domains: Vec<CrmDomain>,
}

/// Cached metadata about a company keyed on its email domain. Resolved
/// by [`CompanyMetadataResolver`] (the Apollo.io organization-enrichment
/// adapter) and stored in `crm_domain_directory`.
///
/// Every scalar is `Option` and every list defaults empty: the resolver
/// may succeed with little data or fail entirely, and both collapse to an
/// all-empty row so the directory doubles as a negative cache.
///
/// [`CompanyMetadataResolver`]: crate::domain::company_metadata_resolver::CompanyMetadataResolver
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DomainMetadata {
    /// Company display name (Apollo `name`).
    pub name: Option<String>,
    /// Short company description (Apollo `short_description`).
    pub description: Option<String>,
    /// Logo / icon URL (Apollo `logo_url`).
    pub icon_url: Option<String>,
    /// Apollo's organization id, for re-enrichment / linking.
    pub apollo_organization_id: Option<String>,
    /// Canonical company website (Apollo `website_url`).
    pub website_url: Option<String>,
    /// LinkedIn company URL.
    pub linkedin_url: Option<String>,
    /// Twitter / X URL.
    pub twitter_url: Option<String>,
    /// Facebook URL.
    pub facebook_url: Option<String>,
    /// Primary industry (Apollo `industry`).
    pub industry: Option<String>,
    /// Free-text keywords / tags (Apollo `keywords`).
    pub keywords: Vec<String>,
    /// Detected technologies (Apollo `technology_names`).
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
    /// Full Apollo `organization` payload (minus our workspace `account`),
    /// kept so fields we don't model yet aren't lost.
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
    /// The id of the company the contact belongs to
    pub company_id: uuid::Uuid,
    /// The contact's email address
    pub email: String,
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
}

/// Result of [`crate::domain::companies_repo::CompaniesRepository::crm_scope_precheck`].
///
/// Carries the per-input authorization status the caller (`EmailService`)
/// needs to either accept or reject a CRM-scoped query before it runs.
#[derive(Debug, Clone)]
pub struct CrmScopePrecheck {
    /// `team_crm_settings.crm_enabled` for the requesting team. `false`
    /// when the team's row exists with `crm_enabled = false`, *or* when no
    /// row exists at all (older teams predating `team_crm_settings`).
    pub crm_enabled: bool,
    /// One row per requested domain, in the same order as the input list.
    /// **Exception:** when `crm_enabled = false`, this vec is empty —
    /// the email service short-circuits on the killswitch before
    /// consulting per-input rows, so the per-domain probes are skipped
    /// and callers must not assume length parity with the input list
    /// without first checking `crm_enabled`.
    pub domains: Vec<CrmDomainStatus>,
    /// One row per requested address, in the same order as the input
    /// list. Same `crm_enabled = false` exception as [`Self::domains`].
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
    /// `crm_contacts.hidden` for the matched contact. `false` when `!exists`.
    pub contact_hidden: bool,
    /// `crm_companies.hidden` for the matched contact's company. `false` when `!exists`.
    pub company_hidden: bool,
    /// `crm_companies.email_sync` for the matched contact's company. `false` when `!exists`.
    pub email_sync: bool,
}

/// Errors that can occur in the CRM domain.
#[derive(Debug, thiserror::Error)]
pub enum CrmError {
    /// Storage layer error
    #[error("Storage layer error {0}")]
    StorageLayerError(#[from] anyhow::Error),
    /// Company id is not owned by the requesting team.
    #[error("crm company not found for team")]
    CompanyNotFoundForTeam,
    /// Contact id is not owned by the requesting team.
    #[error("crm contact not found for team")]
    ContactNotFoundForTeam,
    /// Comment thread id does not exist, is deleted, or does not belong
    /// to the addressed entity / team.
    #[error("crm comment thread not found")]
    ThreadNotFound,
    /// Comment id does not exist or does not belong to the team.
    #[error("crm comment not found for team")]
    CommentNotFound,
    /// Comment exists and is visible to the caller, but they are not its
    /// author — only the comment owner may edit or delete it.
    #[error("crm comment not owned by caller")]
    CommentNotOwned,
    /// Request rejected for a client-side reason (e.g. blank comment text).
    #[error("{0}")]
    InvalidRequest(String),
    /// Tried to mutate a CRM company in a way that contradicts its
    /// `hidden = true` state — currently raised when attempting to
    /// re-enable `email_sync` on a hidden company.
    #[error("crm company is hidden")]
    CompanyHidden,
    /// Entity access receipt did not contain a valid team UUID.
    #[error("invalid team id in entity access receipt")]
    InvalidTeamId,
}
