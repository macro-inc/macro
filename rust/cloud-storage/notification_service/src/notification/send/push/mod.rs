use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PushNotificationData {
    /// The id of the notification record (UserNotification.id)
    pub notification_id: Uuid,
}

impl PushNotificationData {
    pub fn new_from_inner(val: notification::domain::models::apple::PushNotificationData) -> Self {
        Self {
            notification_id: val.notification_id,
        }
    }
}
