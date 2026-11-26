//! A notification someone sent on purpose, usually from agent code through the
//! SDK, rather than one an event raised.
use super::*;

/// A notification written by its sender: their words, and the entity it
/// opens. The sender is the notification's `sender_id`, or nobody when people
/// notify themselves. One about a channel message is filed under the
/// message's channel and names the message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PingMetadata {
    /// What the sender wrote.
    pub body: String,
    /// The linked entity's name when it was sent, for a push to show under
    /// who sent it. Absent when it has none that reads the same to every
    /// recipient, such as a direct message.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity_name: Option<String>,
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

impl PingMetadata {
    /// Who pinged: the agent whose code sent it, else the person, else the
    /// recipient themselves.
    fn deed(&self, sender: Option<MacroUserIdStr<'_>>) -> String {
        let name = self
            .agent
            .as_ref()
            .map(|agent| agent.name.clone())
            .or_else(|| sender.map(|sender| sender.email_part().local_part().to_string()));
        match name {
            Some(name) => format!("{name} pinged you"),
            None => "You pinged yourself".to_string(),
        }
    }
}

impl NotificationTitle for PingMetadata {
    /// Who pinged and what about, for one line such as a digest's; a push
    /// splits them into its title and subtitle.
    fn format_title(&self, sender: Option<MacroUserIdStr<'_>>) -> Result<String, Report> {
        let deed = self.deed(sender);
        Ok(match self.entity_name.as_deref() {
            Some(name) => format!("{deed} — {name}"),
            None => deed,
        })
    }

    fn format_body(&self, _sender: Option<MacroUserIdStr<'_>>) -> Result<String, Report> {
        Ok(self.body.clone())
    }
}

impl NotificationExtIos for PingMetadata {
    type NotifData = PushNotificationData;

    // A resend of the same words about the same entity, or the same message
    // of a channel, replaces its banner.
    fn collapse_key(&self, entity: &Entity<'_>) -> NotifCollapseKey {
        let key = NotifCollapseKey::new(Self::TYPE_NAME).append(&entity.entity_id);
        match self.message {
            Some(message) => key.append(&message.message_id.to_string()),
            None => key,
        }
        .append(&self.body)
    }

    fn as_apns<'a>(
        &self,
        sender: Option<MacroUserIdStr<'a>>,
        entity: &Entity<'_>,
        id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let deed = self.deed(sender.as_ref().map(CowLike::copied));
        let avatar = self
            .agent
            .as_ref()
            .and_then(|agent| agent.avatar_url.clone());
        let mut apns = match self.message {
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
        }?;
        // Under who pinged, what about; Android joins them again.
        if let Some(Alert::Dictionary(alert)) = &mut apns.aps.alert {
            alert.title = Some(deed);
            alert.subtitle = self.entity_name.clone();
        }
        Some(apns)
    }
}
