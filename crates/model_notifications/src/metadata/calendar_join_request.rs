//! Notification sent when a channel member asks to join a shared calendar event.
use super::*;

/// A channel member who sees a calendar event only through a channel share
/// asked the person who shared it to add them as a guest. Sent to the sharer,
/// with the requester as sender.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEventJoinRequestMetadata {
    /// Stable request identity, answered from the event's details.
    pub request_id: Uuid,
    /// The shared calendar event entity the request is for.
    pub event_id: Uuid,
    /// Event title when the request was made.
    pub title: String,
}
impl Notification for CalendarEventJoinRequestMetadata {
    const TYPE_NAME: &'static str = "calendar_event_join_request";
}
impl CalendarEventJoinRequestMetadata {
    fn display_title(&self) -> &str {
        if self.title.is_empty() {
            "(No title)"
        } else {
            &self.title
        }
    }
}
impl NotificationTitle for CalendarEventJoinRequestMetadata {
    fn format_title(&self, sender: Option<MacroUserIdStr<'_>>) -> Result<String, Report> {
        let sender = comment_sender_label(sender, None);
        Ok(format!("{sender} asked to join {}", self.display_title()))
    }
    fn format_body(&self, _sender: Option<MacroUserIdStr<'_>>) -> Result<String, Report> {
        Ok(self.display_title().to_string())
    }
}
impl NotificationExtIos for CalendarEventJoinRequestMetadata {
    type NotifData = PushNotificationData;
    // A request reopened after a decline replaces its earlier banner.
    fn collapse_key(&self, _entity: &Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new(Self::TYPE_NAME).append(&self.request_id.to_string())
    }
    fn as_apns<'a>(
        &self,
        sender: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        alert_apns(self, sender, id, None).ok()
    }
}
