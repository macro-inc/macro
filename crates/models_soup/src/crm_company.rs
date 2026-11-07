use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A CRM domain as displayed in Soup. Mirrors the crm crate's
/// [`CrmDomain`] with a stable wire shape that the FE can rely on.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SoupCrmDomain {
    /// The id of the domain record.
    pub id: Uuid,
    /// The id of the company the domain belongs to.
    pub company_id: Uuid,
    /// The domain (lowercased, e.g. "acme.com").
    pub domain: String,
    /// When the domain record was created.
    pub created_at: DateTime<Utc>,
}

/// A CRM company as displayed in Soup. Carries the core company
/// fields plus display metadata resolved from `crm_domain_directory`
/// against the primary (earliest-created) domain.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SoupCrmCompany<T = ()> {
    /// The id of the company.
    pub id: Uuid,
    /// The id of the team that owns this company record.
    pub team_id: Uuid,
    /// Display name from the primary domain's directory entry, or
    /// `None` when unresolved.
    pub name: Option<String>,
    /// Display description from the primary domain's directory entry.
    pub description: Option<String>,
    /// Whether email sync is enabled for this company.
    pub email_sync: bool,
    /// Whether the company is hidden from CRM listings. Soup filters
    /// these out by default.
    pub hidden: bool,
    /// When the company was created.
    pub created_at: DateTime<Utc>,
    /// When the company was last updated.
    pub updated_at: DateTime<Utc>,
    /// When the requesting user last viewed this company, or `None` if
    /// never viewed. Mirrors the `viewed_at` other soup entities carry.
    pub viewed_at: Option<DateTime<Utc>>,
    /// Domains associated with this company, ordered by creation time
    /// ascending (primary first).
    pub domains: Vec<SoupCrmDomain>,
    /// Extra fields passed from above
    #[serde(flatten)]
    pub extra: T,
}
