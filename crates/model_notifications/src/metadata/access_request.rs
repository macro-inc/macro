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
