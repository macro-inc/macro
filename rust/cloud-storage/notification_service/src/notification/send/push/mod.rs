use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PushNotificationData {
    /// The id of the notification record (UserNotification.id)
    pub notification_id: Uuid,
    #[serde(flatten)]
    pub notification_entity: model_entity::Entity<'static>,
    /// user id of the macro user who generated the notification
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sender_id: Option<String>,
    /// The route to open the notification in the app
    /// example: /channel/{channel_id}
    pub open_route: String,
}

impl PushNotificationData {
    pub fn new_from_inner(val: notification::domain::models::apple::PushNotificationData) -> Self {
        Self {
            notification_id: val.notification_id,
            notification_entity: val.notification_entity,
            sender_id: val.sender_id,
            open_route: val.open_route,
        }
    }
}
