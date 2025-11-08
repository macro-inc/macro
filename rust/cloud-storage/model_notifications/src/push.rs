use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::NotificationEntity;

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct APNSPushNotification {
    pub aps: serde_json::Value,

    #[serde(flatten)]
    pub push_notification_data: PushNotificationData,
}

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PushNotificationData {
    #[serde(flatten)]
    pub notification_entity: NotificationEntity,
    /// user id of the macro user who generated the notification
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sender_id: Option<String>,
    /// The route to open the notification in the app
    /// example: /channel/{channel_id}
    pub open_route: String,
}
