//! Notifications for comments on projects, using shared message/thread identities.

use super::*;

#[cfg(test)]
mod test;

/// Why a project discussion notification was delivered.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum InitiativeDiscussionReason {
    /// Explicit user mention.
    Mention,
    /// Reply in a discussion the recipient joined.
    Reply,
    /// Comment on a project assigned to the recipient.
    Assignee,
    /// Comment on a project owned by the recipient.
    Owner,
}

/// Project discussion metadata. The notification entity identifies the initiative;
/// message and thread UUIDs select the discussion inside that project.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InitiativeDiscussionMetadata {
    /// Name displayed in the project header.
    pub project_name: String,
    /// Authenticated project owner.
    #[schema(value_type = String)]
    pub owner: Owner,
    /// Semantic reason selected by the message delivery domain.
    pub reason: InitiativeDiscussionReason,
    /// Canonical shared message UUID.
    pub message_id: Uuid,
    /// Canonical discussion root UUID.
    pub thread_id: Uuid,
    /// Posted Markdown content.
    pub text: String,
    /// Public display name for a bot author.
    pub sender_display_name: Option<String>,
    /// Optional avatar for push notification attachments.
    pub sender_profile_picture_url: Option<String>,
}

impl Notification for InitiativeDiscussionMetadata {
    const TYPE_NAME: &'static str = "initiative_discussion";
}

impl NotificationTitle for InitiativeDiscussionMetadata {
    fn format_title(
        &self,
        sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let sender = comment_sender_label(sender_id, self.sender_display_name.as_deref());
        let action = match self.reason {
            InitiativeDiscussionReason::Mention => "mentioned you in",
            InitiativeDiscussionReason::Reply => "replied in",
            InitiativeDiscussionReason::Assignee | InitiativeDiscussionReason::Owner => {
                "commented on"
            }
        };
        Ok(format!("{sender} {action} {}", self.project_name))
    }

    fn format_body(&self, _: Option<MacroUserIdStr<'_>>) -> Result<String, rootcause::Report> {
        parse_message_plain_text(&self.text)
    }
}

impl NotificationExtIos for InitiativeDiscussionMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;

    fn collapse_key(&self, entity: &Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new("initiative").append(&entity.entity_id)
    }

    fn as_apns<'a>(
        &self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        alert_apns(
            self,
            sender_id,
            notification_id,
            self.sender_profile_picture_url.clone(),
        )
        .ok()
    }
}
