//! Notifications attached to a shared entity's access request.
use super::*;

/// Permission level used by an access request, excluding ownership.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum RequestedAccessLevel {
    /// View access.
    View,
    /// Comment access.
    Comment,
    /// Edit access.
    Edit,
}
impl std::fmt::Display for RequestedAccessLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::View => "view",
            Self::Comment => "comment",
            Self::Edit => "edit",
        })
    }
}

/// A person requested access to a shared entity.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EntityAccessRequestedMetadata {
    /// Stable request identity.
    pub request_id: Uuid,
    /// Revision that generated this notification.
    pub revision: i32,
    /// Shared item's name.
    pub entity_name: String,
    /// Document file type for routing.
    pub file_type: Option<String>,
    /// Requested or granted permission.
    pub access_level: RequestedAccessLevel,
}
impl Notification for EntityAccessRequestedMetadata {
    const TYPE_NAME: &'static str = "entity_access_requested";
}
impl NotificationTitle for EntityAccessRequestedMetadata {
    fn format_title(&self, sender: Option<MacroUserIdStr<'_>>) -> Result<String, Report> {
        let sender = comment_sender_label(sender, None);
        Ok(format!(
            "{sender} requested {} access to {}",
            self.access_level, self.entity_name
        ))
    }
    fn format_body(&self, _sender: Option<MacroUserIdStr<'_>>) -> Result<String, Report> {
        Ok(self.entity_name.clone())
    }
}
impl NotificationExtIos for EntityAccessRequestedMetadata {
    type NotifData = PushNotificationData;
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

/// A person granted you access to a shared entity.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EntityAccessGrantedMetadata {
    /// Stable request identity.
    pub request_id: Uuid,
    /// Revision that generated this notification.
    pub revision: i32,
    /// Shared item's name.
    pub entity_name: String,
    /// Document file type for routing.
    pub file_type: Option<String>,
    /// Requested or granted permission.
    pub access_level: RequestedAccessLevel,
}
impl Notification for EntityAccessGrantedMetadata {
    const TYPE_NAME: &'static str = "entity_access_granted";
}
impl NotificationTitle for EntityAccessGrantedMetadata {
    fn format_title(&self, sender: Option<MacroUserIdStr<'_>>) -> Result<String, Report> {
        let sender = comment_sender_label(sender, None);
        Ok(format!(
            "{sender} granted you {} access to {}",
            self.access_level, self.entity_name
        ))
    }
    fn format_body(&self, _sender: Option<MacroUserIdStr<'_>>) -> Result<String, Report> {
        Ok(self.entity_name.clone())
    }
}
impl NotificationExtIos for EntityAccessGrantedMetadata {
    type NotifData = PushNotificationData;
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

/// One of the recipient's agents that stopped with their runtime access.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StoppedAgent {
    /// The agent's bot id.
    pub bot_id: Uuid,
    /// The agent's display name.
    pub name: String,
}

/// A runtime's owner removed the recipient's access to it, or lowered it to
/// Read, and agents the recipient keeps living there stopped.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAccessRemovedMetadata {
    /// The runtime's name.
    pub runtime_name: String,
    /// The recipient's agents living on the runtime, which stopped. Never
    /// empty: without one there is nothing to tell them.
    pub agents: Vec<StoppedAgent>,
}
impl Notification for RuntimeAccessRemovedMetadata {
    const TYPE_NAME: &'static str = "runtime_access_removed";
}
impl NotificationTitle for RuntimeAccessRemovedMetadata {
    fn format_title(&self, sender: Option<MacroUserIdStr<'_>>) -> Result<String, Report> {
        let sender = comment_sender_label(sender, None);
        Ok(format!(
            "{sender} removed your access to {}",
            self.runtime_name
        ))
    }
    fn format_body(&self, _sender: Option<MacroUserIdStr<'_>>) -> Result<String, Report> {
        let names: Vec<&str> = self
            .agents
            .iter()
            .map(|agent| agent.name.as_str())
            .collect();
        Ok(match names.as_slice() {
            [] => format!("Agents on {} have stopped.", self.runtime_name),
            [one] => format!("{one} has stopped."),
            [first, second] => format!("{first} and {second} have stopped."),
            [first, rest @ ..] => format!("{first} and {} others have stopped.", rest.len()),
        })
    }
}
impl NotificationExtIos for RuntimeAccessRemovedMetadata {
    type NotifData = PushNotificationData;
    fn collapse_key(&self, entity: &Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new(Self::TYPE_NAME).append(&entity.entity_id)
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

/// A person asked to join a channel the recipient participates in.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChannelAccessRequestedMetadata {
    /// The attempt to join, which is also this notification's id.
    pub request_id: Uuid,
    /// Channel the requester asked to join.
    #[serde(flatten)]
    pub common: CommonChannelMetadata,
    /// Optional requester profile picture URL.
    #[serde(default)]
    pub sender_profile_picture_url: Option<String>,
}
impl Notification for ChannelAccessRequestedMetadata {
    const TYPE_NAME: &'static str = "channel_access_requested";
}
impl NotificationTitle for ChannelAccessRequestedMetadata {
    fn format_title(&self, sender: Option<MacroUserIdStr<'_>>) -> Result<String, Report> {
        let sender = comment_sender_label(sender, None);
        Ok(format!(
            "{sender} asked to join #{}",
            self.common.channel_name
        ))
    }
    fn format_body(&self, _sender: Option<MacroUserIdStr<'_>>) -> Result<String, Report> {
        Ok(format!("#{}", self.common.channel_name))
    }
}
impl NotificationExtIos for ChannelAccessRequestedMetadata {
    type NotifData = PushNotificationData;
    fn collapse_key(&self, _entity: &Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new(Self::TYPE_NAME).append(&self.request_id.to_string())
    }
    fn as_apns<'a>(
        &self,
        sender: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        alert_apns(self, sender, id, self.sender_profile_picture_url.clone()).ok()
    }
}
