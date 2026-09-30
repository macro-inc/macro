use chrono::{DateTime, Utc};
use model_owner::Owner;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// An initiative (called a project in the frontend) in the Soup feed.
#[derive(Serialize, Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct SoupInitiative<T = ()> {
    /// Initiative identifier.
    pub id: Uuid,
    /// Initiative display name.
    pub name: String,
    /// Initiative owner.
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    pub owner_id: Owner,
    /// Document holding the initiative description.
    pub description_document_id: Option<Uuid>,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Last modification timestamp.
    pub updated_at: DateTime<Utc>,
    /// Last time the requesting user viewed the initiative.
    pub viewed_at: Option<DateTime<Utc>>,
    /// Enrichment attached by the caller.
    #[serde(flatten)]
    pub extra: T,
}
