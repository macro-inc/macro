use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct CheckChannelsForUserRequest {
    pub user_id: String,
    pub channel_ids: Vec<Uuid>,
}
