//! The titles CRM chips show for companies and contacts, read many at a time.

use chrono::{DateTime, Utc};
use uuid::Uuid;

/// Most ids of each kind one preview read accepts.
pub const MAX_PREVIEW_IDS: usize = 100;

/// What a company chip shows: the fields the company read returns for its
/// title, without its contacts.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct CrmCompanyPreview {
    /// The requested company id.
    pub id: Uuid,
    /// The company the requested one was merged into, which is the one the
    /// rest of the preview shows. Absent for a company that was not merged.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merged_into: Option<Uuid>,
    /// The team's name override, else the primary domain's directory name.
    pub name: Option<String>,
    /// The company's first domain, which titles a company with no name.
    pub primary_domain: Option<String>,
    /// The company's last interaction, as the company read's `updatedAt`.
    pub updated_at: DateTime<Utc>,
}

/// What a contact chip shows.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct CrmContactPreview {
    /// The contact.
    pub id: Uuid,
    /// The contact's display name.
    pub name: Option<String>,
    /// The contact's primary email, which titles a contact with no name.
    pub email: Option<String>,
    /// When the contact record last changed.
    pub updated_at: DateTime<Utc>,
}

/// The previews of the requested records the viewer may open; a record the
/// viewer may not open, or that does not exist, is left out.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct CrmPreviews {
    /// Company previews, in no particular order.
    pub companies: Vec<CrmCompanyPreview>,
    /// Contact previews, in no particular order.
    pub contacts: Vec<CrmContactPreview>,
}
