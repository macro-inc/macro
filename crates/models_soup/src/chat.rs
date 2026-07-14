use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::SoupProperty;

/// A chat as displayed in Soup.
#[derive(Serialize, Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct SoupChat {
    /// The chat uuid
    pub id: Uuid,

    /// The name of the chat
    pub name: String,

    /// Who the chat belongs to
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    pub owner_id: MacroUserIdStr<'static>,

    /// The project id of the chat
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<Uuid>,

    /// Whether the chat is persistent or not
    pub is_persistent: bool,

    /// The time the chat was created
    pub created_at: chrono::DateTime<Utc>,

    /// The time the chat was last updated
    pub updated_at: chrono::DateTime<Utc>,

    /// The time the chat was last viewed
    pub viewed_at: Option<chrono::DateTime<Utc>>,

    /// The time the chat was deleted
    pub deleted_at: Option<chrono::DateTime<Utc>>,

    /// Properties
    pub properties: Vec<SoupProperty>,
}
