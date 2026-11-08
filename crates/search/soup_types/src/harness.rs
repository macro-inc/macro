use chrono::Utc;
use model_owner::Owner;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A paired runtime (a macrod machine), listed only by attention feeds: its
/// access requests and removals are notifications filed under it, and it has
/// no page of its own, so Settings → Machines opens it.
#[derive(Serialize, Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct SoupHarness {
    /// The harness uuid.
    pub id: Uuid,

    /// The machine's display name.
    pub name: String,

    /// The person or team that owns the machine.
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    pub owner_id: Owner,

    /// When the machine was paired.
    pub created_at: chrono::DateTime<Utc>,

    /// When the machine was last changed.
    pub updated_at: chrono::DateTime<Utc>,
}
