use chrono::serde::ts_seconds_option;
use utoipa::ToSchema;

use crate::item::Item;
pub mod request;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Pin {
    /// The id of the pinned item
    pub pinned_item_id: String,
    /// The type of the pinned item
    /// This is either document, chat, or project
    pub pinned_item_type: String,
    /// The index of the pinned item
    pub pin_index: i32,
    /// Who the chat belongs to
    pub user_id: String,
    /// The time the pin was created
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    /// The time the pin was last updated
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PinnedItem {
    /// The pin index
    pub pin_index: i32,
    /// The activity that was pinned
    pub item: Item,
    /// legacy will be removed later
    pub activity: Item,
}
