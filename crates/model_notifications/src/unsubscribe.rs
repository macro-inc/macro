use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct UserUnsubscribe {
    /// The item id
    pub item_id: String,
    /// The item type
    pub item_type: String,
}
