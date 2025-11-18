use chrono::Utc;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Serialize, Clone, Deserialize, Debug, ToSchema)]
#[cfg_attr(feature = "mock", derive(PartialEq, Eq))]
#[serde(rename_all = "camelCase")]
pub struct SoupChat {
    /// The chat uuid
    pub id: String,

    /// The name of the chat
    pub name: String,

    /// Who the chat belongs to
    pub owner_id: String,

    /// The project id of the chat
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,

    /// Whether the chat is persistent or not
    pub is_persistent: bool,

    /// The time the chat was created
    #[serde(with = "chrono::serde::ts_milliseconds")]
    #[schema(value_type = i64)]
    pub created_at: chrono::DateTime<Utc>,

    /// The time the chat was last updated
    #[serde(with = "chrono::serde::ts_milliseconds")]
    #[schema(value_type = i64)]
    pub updated_at: chrono::DateTime<Utc>,

    /// The time the chat was last viewed
    #[serde(with = "chrono::serde::ts_milliseconds_option")]
    #[schema(value_type = i64, nullable = true)]
    pub viewed_at: Option<chrono::DateTime<Utc>>,
}

#[expect(
    clippy::too_many_arguments,
    reason = "no good reason but too hard to fix right now"
)]
pub fn map_soup_chat(
    id: String,
    user_id: String,
    name: String,
    project_id: Option<String>,
    is_persistent: Option<bool>,
    created_at: chrono::DateTime<Utc>,
    updated_at: chrono::DateTime<Utc>,
    viewed_at: Option<chrono::DateTime<Utc>>,
) -> SoupChat {
    SoupChat {
        id,
        owner_id: user_id,
        name,
        project_id,
        created_at,
        updated_at,
        is_persistent: is_persistent.unwrap_or(false),
        viewed_at,
    }
}
