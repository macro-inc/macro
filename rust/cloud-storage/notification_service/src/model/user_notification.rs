use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NotificationBulkRequest {
    /// The ids of the notifications to handle
    pub notification_ids: Vec<String>,
}
