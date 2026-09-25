//! Notifications for comments on CRM companies and contacts, using shared
//! message/thread identities.

use super::*;

#[cfg(test)]
mod test;

/// Why a CRM discussion notification was delivered.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CrmDiscussionReason {
    /// Explicit user mention.
    Mention,
    /// Reply in a discussion the recipient joined.
    Reply,
    /// Comment on a company the recipient owns, or on one of its contacts.
    Owner,
}

/// CRM discussion metadata. The notification entity identifies the company or
/// contact; message and thread UUIDs select the discussion inside it.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CrmDiscussionMetadata {
    /// Company or contact display name.
    pub record_name: String,
    /// Semantic reason selected by the message delivery domain.
    pub reason: CrmDiscussionReason,
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

impl Notification for CrmDiscussionMetadata {
    const TYPE_NAME: &'static str = "crm_discussion";
}

impl NotificationTitle for CrmDiscussionMetadata {
    fn format_title(
        &self,
        sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let sender = comment_sender_label(sender_id, self.sender_display_name.as_deref());
        let action = match self.reason {
            CrmDiscussionReason::Mention => "mentioned you in",
            CrmDiscussionReason::Reply => "replied in",
            CrmDiscussionReason::Owner => "commented on",
        };
        Ok(format!("{sender} {action} {}", self.record_name))
    }

    fn format_body(&self, _: Option<MacroUserIdStr<'_>>) -> Result<String, rootcause::Report> {
        parse_message_plain_text(&self.text)
    }
}

impl NotificationExtIos for CrmDiscussionMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;

    fn collapse_key(&self, entity: &Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new("crm")
            .append(&entity.entity_id)
            .append(&self.thread_id.to_string())
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
