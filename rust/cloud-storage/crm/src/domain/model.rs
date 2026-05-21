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
    /// When the company was created
    pub created_at: DateTime<Utc>,
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

/// Errors that can occur in the CRM domain.
#[derive(Debug, thiserror::Error)]
pub enum CrmError {
    /// Storage layer error
    #[error("Storage layer error {0}")]
    StorageLayerError(#[from] anyhow::Error),
}
