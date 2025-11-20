use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Serialize, Clone, Deserialize, Debug)]
#[cfg_attr(feature = "mock", derive(PartialEq, Eq))]
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
    #[serde(with = "chrono::serde::ts_milliseconds")]
    #[cfg_attr(feature = "schema", schema(value_type = i64))]
    pub created_at: chrono::DateTime<Utc>,

    /// The time the chat was last updated
    #[serde(with = "chrono::serde::ts_milliseconds")]
    #[cfg_attr(feature = "schema", schema(value_type = i64))]
    pub updated_at: chrono::DateTime<Utc>,

    /// The time the chat was last viewed
    #[serde(with = "chrono::serde::ts_milliseconds_option")]
    #[cfg_attr(feature = "schema", schema(value_type = i64, nullable = true))]
    pub viewed_at: Option<chrono::DateTime<Utc>>,
}
