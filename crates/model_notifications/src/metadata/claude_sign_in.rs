//! Notification sent when a Macro computer's Claude sign-in is running out.
use super::*;

/// How close a computer's Claude sign-in is to no longer working.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ClaudeSignInExpiryStage {
    /// It expires within three days.
    ExpiresSoon,
    /// It expires within a day.
    ExpiresToday,
    /// It expired, or Claude rejected it.
    Expired,
}

/// The Claude account a team's Macro computer is signed in to is about to
/// stop working, or has. Sent to whoever signed it in and to the team's
/// admins and owner, who can sign it in again from Settings → Runtimes.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSignInExpiryMetadata {
    /// The computer's harness, whose runtime row holds the sign-in.
    pub harness_id: Uuid,
    /// The computer's name when the notice was sent.
    pub computer_name: String,
    /// How close the sign-in is to no longer working.
    pub stage: ClaudeSignInExpiryStage,
    /// When the sign-in expires or expired; absent when Claude rejected it.
    pub expires_at: Option<DateTime<Utc>>,
}

impl Notification for ClaudeSignInExpiryMetadata {
    const TYPE_NAME: &'static str = "claude_sign_in_expiry";
}

impl NotificationTitle for ClaudeSignInExpiryMetadata {
    fn format_title(&self, _sender_id: Option<MacroUserIdStr<'_>>) -> Result<String, Report> {
        let computer = &self.computer_name;
        Ok(match self.stage {
            ClaudeSignInExpiryStage::ExpiresSoon => {
                format!("Claude sign-in on {computer} expires soon")
            }
            ClaudeSignInExpiryStage::ExpiresToday => {
                format!("Claude sign-in on {computer} expires today")
            }
            ClaudeSignInExpiryStage::Expired => format!("Claude sign-in on {computer} expired"),
        })
    }

    fn format_body(&self, _sender_id: Option<MacroUserIdStr<'_>>) -> Result<String, Report> {
        Ok(match self.stage {
            ClaudeSignInExpiryStage::ExpiresSoon | ClaudeSignInExpiryStage::ExpiresToday => {
                "Sign in again in Settings → Runtimes to keep the team's agents running on it."
            }
            ClaudeSignInExpiryStage::Expired => {
                "The team's agents can't use it until someone signs in again in Settings → Runtimes."
            }
        }
        .to_owned())
    }
}

impl NotificationExtIos for ClaudeSignInExpiryMetadata {
    type NotifData = PushNotificationData;

    fn collapse_key(&self, _entity: &Entity<'_>) -> NotifCollapseKey {
        // One alert per computer: a later stage replaces the earlier one.
        NotifCollapseKey::new(Self::TYPE_NAME).append(&self.harness_id.to_string())
    }

    fn as_apns<'a>(
        &self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        alert_apns(self, sender_id, notification_id, None).ok()
    }
}
