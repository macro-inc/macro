//! Notification sent when an agent asks for access to a vault item.
use super::*;

/// An agent asked for access to a team vault item. Sent to the item's current
/// human creator and the team's current administrators, with the agent as
/// sender. Carries the item name and opaque ids only, never values.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PasswordAccessRequestedMetadata {
    /// Request under review.
    pub request_id: Uuid,
    /// Team owning the item.
    pub team_id: Uuid,
    /// Requested item.
    pub item_id: Uuid,
    /// Item display name when the request was made.
    pub item_name: String,
}
impl Notification for PasswordAccessRequestedMetadata {
    const TYPE_NAME: &'static str = "password_access_requested";
}
impl NotificationTitle for PasswordAccessRequestedMetadata {
    fn format_title(&self, sender: Option<MacroUserIdStr<'_>>) -> Result<String, Report> {
        let sender = comment_sender_label(sender, None);
        Ok(format!("{sender} requested access to {}", self.item_name))
    }
    fn format_body(&self, _sender: Option<MacroUserIdStr<'_>>) -> Result<String, Report> {
        Ok(self.item_name.clone())
    }
}
impl NotificationExtIos for PasswordAccessRequestedMetadata {
    type NotifData = PushNotificationData;
    fn collapse_key(&self, _entity: &Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new(Self::TYPE_NAME).append(&self.request_id.to_string())
    }
    // Delivered to the inbox and live connections only; never a push.
    fn as_apns<'a>(
        &self,
        _sender: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        _id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        None
    }
}
