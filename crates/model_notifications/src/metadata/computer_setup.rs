//! Notification sent to a Macro computer's buyer when its first setup ends.
use super::*;

/// How a computer's first setup ended.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ComputerSetupOutcome {
    /// macrod connected for the first time: the computer is ready.
    Ready,
    /// Setup gave up before the computer was ready.
    Failed {
        /// Why, in the words the computer's status shows.
        #[serde(rename = "failureReason")]
        failure_reason: String,
    },
}

/// A team's Macro computer finished first-time setup, or could not be set
/// up. Sent to its buyer, who continues (or retries) from the setup flow.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ComputerSetupMetadata {
    /// The computer that was set up.
    pub computer_id: Uuid,
    /// The computer's harness, once macrod has connected.
    pub harness_id: Option<Uuid>,
    /// The computer's name when the notice was sent.
    pub computer_name: String,
    /// Ready, or why setup failed.
    pub outcome: ComputerSetupOutcome,
}

impl Notification for ComputerSetupMetadata {
    const TYPE_NAME: &'static str = "computer_setup";
}

impl NotificationTitle for ComputerSetupMetadata {
    fn format_title(&self, _sender_id: Option<MacroUserIdStr<'_>>) -> Result<String, Report> {
        Ok(match &self.outcome {
            ComputerSetupOutcome::Ready => {
                "Your computer is ready: connect your AI and finish setup".to_owned()
            }
            ComputerSetupOutcome::Failed { .. } => {
                format!("{} could not be set up", self.computer_name)
            }
        })
    }

    fn format_body(&self, _sender_id: Option<MacroUserIdStr<'_>>) -> Result<String, Report> {
        Ok(match &self.outcome {
            ComputerSetupOutcome::Ready => format!(
                "{} is up. Bring your AI, then create an agent on it.",
                self.computer_name
            ),
            ComputerSetupOutcome::Failed { failure_reason } => {
                format!("{failure_reason} Retry from the setup flow.")
            }
        })
    }
}

impl NotificationExtIos for ComputerSetupMetadata {
    type NotifData = PushNotificationData;

    fn collapse_key(&self, _entity: &Entity<'_>) -> NotifCollapseKey {
        // One alert per computer: a later outcome replaces the earlier one.
        NotifCollapseKey::new(Self::TYPE_NAME).append(&self.computer_id.to_string())
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
