//! Notification sent when a Macro computer's agent sign-in is running out.
use super::*;

/// How close a computer's agent sign-in is to no longer working.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentSignInExpiryStage {
    /// It expires within three days.
    ExpiresSoon,
    /// It expires within a day.
    ExpiresToday,
    /// It expired, or the agent rejected it.
    Expired,
}

/// The account a team's Macro computer signed an agent in to is about to
/// stop working, or has. Sent to whoever signed it in and to the team's
/// admins and owner, who can sign it in again from Settings → Machines.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentSignInExpiryMetadata {
    /// The agent whose sign-in is running out.
    pub agent: AgentProvider,
    /// The computer's harness, whose runtime row holds the sign-in.
    pub harness_id: Uuid,
    /// The computer's name when the notice was sent.
    pub computer_name: String,
    /// How close the sign-in is to no longer working.
    pub stage: AgentSignInExpiryStage,
    /// When the sign-in expires or expired; absent when the agent rejected it.
    pub expires_at: Option<DateTime<Utc>>,
}

impl Notification for AgentSignInExpiryMetadata {
    const TYPE_NAME: &'static str = "agent_sign_in_expiry";
}

impl NotificationTitle for AgentSignInExpiryMetadata {
    fn format_title(&self, _sender_id: Option<MacroUserIdStr<'_>>) -> Result<String, Report> {
        let agent = self.agent.display_name();
        let computer = &self.computer_name;
        Ok(match self.stage {
            AgentSignInExpiryStage::ExpiresSoon => {
                format!("{agent} sign-in on {computer} expires soon")
            }
            AgentSignInExpiryStage::ExpiresToday => {
                format!("{agent} sign-in on {computer} expires today")
            }
            AgentSignInExpiryStage::Expired => format!("{agent} sign-in on {computer} expired"),
        })
    }

    fn format_body(&self, _sender_id: Option<MacroUserIdStr<'_>>) -> Result<String, Report> {
        Ok(match self.stage {
            AgentSignInExpiryStage::ExpiresSoon | AgentSignInExpiryStage::ExpiresToday => {
                "Sign in again in Settings → Machines to keep the team's agents running on it."
            }
            AgentSignInExpiryStage::Expired => {
                "The team's agents can't use it until someone signs in again in Settings → Machines."
            }
        }
        .to_owned())
    }
}

impl NotificationExtIos for AgentSignInExpiryMetadata {
    type NotifData = PushNotificationData;

    fn collapse_key(&self, _entity: &Entity<'_>) -> NotifCollapseKey {
        // One alert per computer and agent: a later stage replaces the earlier one.
        NotifCollapseKey::new(Self::TYPE_NAME)
            .append(&self.harness_id.to_string())
            .append(self.agent.as_ref())
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
