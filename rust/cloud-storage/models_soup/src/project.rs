use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Serialize, Clone, Deserialize, Debug)]
#[cfg_attr(feature = "mock", derive(PartialEq, Eq))]
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
    #[serde(with = "chrono::serde::ts_milliseconds")]
    #[cfg_attr(feature = "schema", schema(value_type = i64))]
    pub created_at: chrono::DateTime<Utc>,

    /// The time the project was updated
    #[serde(with = "chrono::serde::ts_milliseconds")]
    #[cfg_attr(feature = "schema", schema(value_type = i64))]
    pub updated_at: chrono::DateTime<Utc>,

    /// The time the document was last viewed
    #[serde(with = "chrono::serde::ts_milliseconds_option")]
    #[cfg_attr(feature = "schema", schema(value_type = i64, nullable = true))]
    pub viewed_at: Option<chrono::DateTime<Utc>>,
}
