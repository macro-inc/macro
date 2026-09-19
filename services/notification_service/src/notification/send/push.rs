use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PushNotificationData {
    /// The id of the notification record (UserNotification.id)
    pub notification_id: Uuid,
    /// The sender's profile picture URL, used by the Notification Service Extension
    /// to download and attach as a rich notification image.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    pub sender_profile_picture_url: Option<String>,
}

impl PushNotificationData {
    pub fn new_from_inner(val: notification::domain::models::apple::PushNotificationData) -> Self {
        Self {
            notification_id: val.notification_id,
            sender_profile_picture_url: val.sender_profile_picture_url,
        }
    }
}
