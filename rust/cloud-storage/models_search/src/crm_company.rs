//! CRM company items in unified search results. Postgres-only, hydrated
//! from the `crm` crate's search service; the `crm` types are mapped into
//! these wire shapes in `search_service` so this crate stays dep-light.

use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

/// A CRM domain attached to a company in search results.
#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CrmCompanySearchDomain {
    /// The id of the domain record.
    pub id: Uuid,
    /// The id of the company the domain belongs to.
    pub company_id: Uuid,
    /// The domain (lowercased, e.g. "acme.com").
    pub domain: String,
    /// When the domain record was created.
    pub created_at: DateTime<Utc>,
}

/// A CRM company match in unified search results. Carries the display
/// metadata resolved from the primary domain plus the highlighted name.
#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CrmCompanySearchResponseItem {
    /// The id of the company.
    pub id: Uuid,
    /// The id of the team that owns this company record.
    pub team_id: Uuid,
    /// Display name from the primary domain's directory entry.
    pub name: Option<String>,
    /// `name` with matched spans wrapped in `<macro_em>…</macro_em>`.
    pub name_highlighted: Option<String>,
    /// Display description from the primary domain's directory entry.
    pub description: Option<String>,
    /// Whether the company is hidden from CRM listings.
    pub hidden: bool,
    /// When the company was created.
    pub created_at: DateTime<Utc>,
    /// When the company was last updated (the sort key).
    pub updated_at: DateTime<Utc>,
    /// Domains associated with this company, primary first.
    pub domains: Vec<CrmCompanySearchDomain>,
}
