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
    /// The notification type name (e.g. `new_email`), used by the Notification
    /// Service Extension to pick per-type rendering such as the generic email
    /// avatar fallback.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    pub notification_type: Option<String>,
    /// Sender line for the communication-notification layout, without any
    /// channel suffix (e.g. `hutch mentioned you`). The Notification Service
    /// Extension falls back to the alert title when absent.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    pub communication_title: Option<String>,
    /// Conversation group name (e.g. `#bug-reports`) rendered as the second
    /// line of a group communication notification. Only set for non-DM
    /// channel notifications.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    pub group_name: Option<String>,
    /// Stable conversation identifier (channel or email-thread id) for
    /// `INSendMessageIntent.conversationIdentifier`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    pub conversation_id: Option<String>,
}

impl PushNotificationData {
    pub fn new_from_inner(val: notification::domain::models::apple::PushNotificationData) -> Self {
        Self {
            notification_id: val.notification_id,
            sender_profile_picture_url: val.sender_profile_picture_url,
            notification_type: val.notification_type,
            communication_title: val.communication_title,
            group_name: val.group_name,
            conversation_id: val.conversation_id,
        }
    }
}
