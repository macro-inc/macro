//! Domain models for CRM companies and their related records.

use chrono::{DateTime, Utc};

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

/// Cached metadata about a company keyed on its email domain. Populated
/// lazily by [`crate::domain::company_metadata_resolver::CompanyMetadataResolver`] (typically
/// an unfurl of `https://{domain}`) and stored in `crm_domain_directory`.
///
/// Every field is `Option` because the resolver may succeed with the
/// page returning no useful metadata, or fail entirely — both cases
/// are represented as a row with all-NULL fields so the cache is a
/// negative cache as well as a positive one.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DomainMetadata {
    /// Display name of the company (typically the page `<title>` /
    /// `og:title`).
    pub name: Option<String>,
    /// Short description of the company (typically `og:description`).
    pub description: Option<String>,
    /// URL of a logo / icon for the company (favicon resolved from the
    /// page's `<link rel="icon">`, falling back to `/favicon.ico`).
    pub icon_url: Option<String>,
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
    /// Tried to mutate a CRM company in a way that contradicts its
    /// `hidden = true` state — currently raised when attempting to
    /// re-enable `email_sync` on a hidden company.
    #[error("crm company is hidden")]
    CompanyHidden,
    /// Entity access receipt did not contain a valid team UUID.
    #[error("invalid team id in entity access receipt")]
    InvalidTeamId,
}
