//! Notification sent to a Macro computer's buyer when its first setup ends;
//! for an agent teammate's computer, that is the agent's inviter.
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

/// The agent teammate a computer was bought for, so its inviter hears about
/// the agent rather than the machine.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ComputerSetupAgent {
    /// The agent's Macro user id, to open a DM with it.
    pub user_id: String,
    /// The agent's name.
    pub name: String,
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
    /// The agent teammate the computer runs; absent for a plain computer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<ComputerSetupAgent>,
    /// Ready, or why setup failed.
    pub outcome: ComputerSetupOutcome,
}

impl Notification for ComputerSetupMetadata {
    const TYPE_NAME: &'static str = "computer_setup";
}

impl NotificationTitle for ComputerSetupMetadata {
    fn format_title(&self, _sender_id: Option<MacroUserIdStr<'_>>) -> Result<String, Report> {
        if let Some(agent) = &self.agent {
            return Ok(match &self.outcome {
                ComputerSetupOutcome::Ready => format!("{} is ready", agent.name),
                ComputerSetupOutcome::Failed { .. } => {
                    format!("{} couldn't be set up", agent.name)
                }
            });
        }
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
        if let Some(agent) = &self.agent {
            return Ok(match &self.outcome {
                ComputerSetupOutcome::Ready => format!("Message {} to get started.", agent.name),
                ComputerSetupOutcome::Failed { failure_reason } => format!(
                    "{failure_reason} Retry from {}'s row in Members.",
                    agent.name
                ),
            });
        }
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
