//! A notification someone sent on purpose, usually from agent code through the
//! SDK, rather than one an event raised.
use super::*;

/// A notification written by its sender: a title, an optional body, and the
/// entity it opens. The sender is the notification's `sender_id`, or nobody
/// when people notify themselves.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ManualMetadata {
    /// The headline, as the sender wrote it.
    pub title: String,
    /// More detail, as the sender wrote it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    /// The agent whose code sent it, when one did. A string on the wire:
    /// system bots have fixed ids that are not RFC 4122 uuids.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<String>)]
    pub agent_id: Option<Uuid>,
}

impl Notification for ManualMetadata {
    const TYPE_NAME: &'static str = "manual";
}

impl NotificationTitle for ManualMetadata {
    fn format_title(&self, _sender: Option<MacroUserIdStr<'_>>) -> Result<String, Report> {
        Ok(self.title.clone())
    }

    fn format_body(&self, _sender: Option<MacroUserIdStr<'_>>) -> Result<String, Report> {
        Ok(self.body.clone().unwrap_or_default())
    }
}

impl NotificationExtIos for ManualMetadata {
    type NotifData = PushNotificationData;

    // A resend of the same title about the same entity replaces its banner.
    fn collapse_key(&self, entity: &Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new(Self::TYPE_NAME)
            .append(&entity.entity_id)
            .append(&self.title)
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
