use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::SoupProperty;

#[derive(Serialize, Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct SoupProject {
    /// The id of the project
    pub id: Uuid,

    /// The name of the project
    pub name: String,

    /// The user id of who created the project
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    pub owner_id: MacroUserIdStr<'static>,

    /// The parent project id
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<Uuid>,

    /// The time the project was created
    pub created_at: chrono::DateTime<Utc>,

    /// The time the project was updated
    pub updated_at: chrono::DateTime<Utc>,

    /// The time the document was last viewed
    pub viewed_at: Option<chrono::DateTime<Utc>>,

    /// The time the project was deleted
    pub deleted_at: Option<chrono::DateTime<Utc>>,

    /// Properties
    pub properties: Vec<SoupProperty>,
}
