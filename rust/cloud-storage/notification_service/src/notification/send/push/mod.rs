use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

pub mod generate;
pub mod process;
pub mod remove;

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
