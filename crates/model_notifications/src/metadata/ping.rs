//! A notification someone sent on purpose, usually from agent code through the
//! SDK, rather than one an event raised.
use super::*;

/// A notification written by its sender: a title, an optional body, and the
/// entity it opens. The sender is the notification's `sender_id`, or nobody
/// when people notify themselves. One about a channel message is filed under
/// the message's channel and names the message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PingMetadata {
    /// The headline, as the sender wrote it.
    pub title: String,
    /// More detail, as the sender wrote it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    /// The agent whose code sent it, when one did.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<PingAgent>,
    /// The channel message it opens at, when the sender linked one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<PingMessage>,
}

/// The channel message a ping points at.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PingMessage {
    /// The message.
    pub message_id: Uuid,
    /// The top-level message it replies to; absent when it is top-level
    /// itself.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<Uuid>,
}

/// The agent a ping reads as being from, as it was when sent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PingAgent {
    /// A string on the wire: system bots have fixed ids that are not RFC 4122
    /// uuids.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The agent's display name.
    pub name: String,
    /// The agent's avatar.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
}

impl Notification for PingMetadata {
    const TYPE_NAME: &'static str = "ping";
}

impl NotificationTitle for PingMetadata {
    fn format_title(&self, _sender: Option<MacroUserIdStr<'_>>) -> Result<String, Report> {
        Ok(self.title.clone())
    }

    fn format_body(&self, _sender: Option<MacroUserIdStr<'_>>) -> Result<String, Report> {
        Ok(self.body.clone().unwrap_or_default())
    }
}

impl NotificationExtIos for PingMetadata {
    type NotifData = PushNotificationData;

    // A resend of the same title about the same entity, or the same message
    // of a channel, replaces its banner.
    fn collapse_key(&self, entity: &Entity<'_>) -> NotifCollapseKey {
        let key = NotifCollapseKey::new(Self::TYPE_NAME).append(&entity.entity_id);
        match self.message {
            Some(message) => key.append(&message.message_id.to_string()),
            None => key,
        }
        .append(&self.title)
    }

    fn as_apns<'a>(
        &self,
        sender: Option<MacroUserIdStr<'a>>,
        entity: &Entity<'_>,
        id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let avatar = self
            .agent
            .as_ref()
            .and_then(|agent| agent.avatar_url.clone());
        match self.message {
            // A tap opens the channel at the message, like a message push.
            Some(message) => channel_push::channel_apns(
                self,
                sender,
                id,
                avatar,
                entity,
                &message.message_id.to_string(),
                message
                    .thread_id
                    .map(|thread| thread.to_string())
                    .as_deref(),
            ),
            None => alert_apns(self, sender, id, avatar).ok(),
        }
    }
}
