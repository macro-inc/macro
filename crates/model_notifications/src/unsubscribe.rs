use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct UserUnsubscribe {
    /// The item id
    pub item_id: String,
    /// The item type
    pub item_type: String,
    /// None for permanent mutes; notifications resume automatically at this deadline.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snoozed_until: Option<chrono::DateTime<chrono::Utc>>,
}
