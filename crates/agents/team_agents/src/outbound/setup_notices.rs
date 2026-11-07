//! The `computer_setup` notification, through the notification ingress: how
//! a computer's first setup ended (`hosted_runtimes`' `SetupNotices`, sent by
//! the computer operator), and that an agent teammate is up
//! ([`AgentReadyNotices`], sent when the agent first reports online). A
//! computer bought for an agent teammate tells the agent's inviter, by the
//! agent's name; its ready notice waits for the agent rather than macrod.

#[cfg(test)]
mod test;

use std::collections::HashSet;
use std::sync::Arc;

use hosted_runtimes::domain::ids::ComputerId;
use hosted_runtimes::domain::lifecycle::SetupOutcome;
use hosted_runtimes::domain::ports::{SetupNotice, SetupNotices};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use model_notifications::{ComputerSetupAgent, ComputerSetupMetadata, ComputerSetupOutcome};
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::service::NotificationIngress;
use uuid::Uuid;

use crate::domain::models::{AgentReady, TeamAgentError};
use crate::domain::ports::{AgentReadyNotices, TeamAgentRepository};

/// The namespace setup notification ids are derived in, so every retry and
/// redelivery of one notice creates the same notification. Fixed forever.
const NOTIFICATION_ID_NAMESPACE: Uuid = Uuid::from_u128(0x6d61_6372_6f2d_636f_6d70_2d73_6574_7570);

/// The notification ingress refused a notice, or the agent it is about
/// could not be read.
#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct SetupNoticeError(rootcause::Report);

/// [`SetupNotices`] and [`AgentReadyNotices`] over the notification
/// ingress, reading agent teammates from `Agents`.
pub struct IngressSetupNotices<Ingress, Agents> {
    ingress: Arc<Ingress>,
    agents: Agents,
}

impl<Ingress, Agents> IngressSetupNotices<Ingress, Agents> {
    /// Send through `ingress`, naming agents from `agents`.
    pub fn new(ingress: Arc<Ingress>, agents: Agents) -> Self {
        Self { ingress, agents }
    }
}

/// One `computer_setup` notification.
struct Delivery {
    team_id: Uuid,
    computer_id: ComputerId,
    metadata: ComputerSetupMetadata,
    recipient: MacroUserIdStr<'static>,
    notification_id: Uuid,
}

impl<Ingress: NotificationIngress, Agents: TeamAgentRepository>
    IngressSetupNotices<Ingress, Agents>
{
    /// Who hears about an agent's computer, the agent it names, and whether
    /// the agent has reported itself online: the agent's inviter. `None`
    /// when there is no one left to tell: the agent was removed, or its
    /// inviter's account is gone.
    async fn agent_audience(
        &self,
        agent_user_id: &MacroUserIdStr<'static>,
    ) -> Result<Option<(MacroUserIdStr<'static>, ComputerSetupAgent, bool)>, SetupNoticeError> {
        let record = self
            .agents
            .get(agent_user_id)
            .await
            .map_err(|error| SetupNoticeError(rootcause::Report::new(error).into_dynamic()))?;
        let Some(record) = record else {
            return Ok(None);
        };
        let Some(inviter) = record.created_by else {
            return Ok(None);
        };

        let agent = ComputerSetupAgent {
            user_id: agent_user_id.as_ref().to_owned(),
            name: record.persona_seed.name,
        };
        Ok(Some((inviter, agent, record.first_online_at.is_some())))
    }

    async fn deliver(&self, delivery: Delivery) -> Result<(), SetupNoticeError> {
        tracing::debug!(computer_id = %delivery.computer_id, "sending a computer setup notice");
        let request = SendNotificationRequestBuilder {
            notification_entity: EntityType::Team.with_entity_string(delivery.team_id.to_string()),
            secondary_notification_entity: None,
            notification: delivery.metadata,
            sender_id: None,
            recipient_ids: HashSet::from([delivery.recipient]),
        }
        .into_request_with_id(delivery.notification_id)
        .with_apns()
        .with_conn_gateway();
        self.ingress
            .send_notification(request)
            .await
            .map_err(|error| SetupNoticeError(error.into_dynamic()))?;
        Ok(())
    }
}

impl<Ingress: NotificationIngress, Agents: TeamAgentRepository> SetupNotices
    for IngressSetupNotices<Ingress, Agents>
{
    type Err = SetupNoticeError;

    async fn send(&self, notice: SetupNotice) -> Result<(), SetupNoticeError> {
        let notification_id = notification_id(notice.computer_id, &notice.outcome);
        let (recipient, agent) = match &notice.agent {
            None => (notice.buyer.clone(), None),
            Some(agent_user_id) => {
                let Some((inviter, agent, came_online)) =
                    self.agent_audience(agent_user_id).await?
                else {
                    return Ok(());
                };
                // macrod connecting doesn't start the agent: its ready notice
                // waits for the agent's own online report. An agent counted
                // as online already (one invited before reports, whose
                // workspace never sends one) is told about here as before.
                if matches!(notice.outcome, SetupOutcome::Ready) && !came_online {
                    return Ok(());
                }
                (inviter, Some(agent))
            }
        };

        self.deliver(Delivery {
            team_id: notice.team_id,
            computer_id: notice.computer_id,
            metadata: ComputerSetupMetadata {
                computer_id: notice.computer_id.as_uuid(),
                harness_id: notice.harness_id.map(|harness_id| harness_id.as_uuid()),
                computer_name: notice.computer_name,
                agent,
                outcome: match notice.outcome {
                    SetupOutcome::Ready => ComputerSetupOutcome::Ready,
                    SetupOutcome::Failed { failure, .. } => ComputerSetupOutcome::Failed {
                        failure_reason: failure.reason().to_owned(),
                        released: false,
                    },
                    SetupOutcome::Released { failure, .. } => ComputerSetupOutcome::Failed {
                        failure_reason: failure.reason().to_owned(),
                        released: true,
                    },
                },
            },
            recipient,
            notification_id,
        })
        .await
    }
}

impl<Ingress: NotificationIngress, Agents: TeamAgentRepository> AgentReadyNotices
    for IngressSetupNotices<Ingress, Agents>
{
    async fn send(&self, notice: AgentReady) -> Result<(), TeamAgentError> {
        let agent = ComputerSetupAgent {
            user_id: notice.agent.as_ref().to_owned(),
            name: notice.agent_name,
        };
        self.deliver(Delivery {
            team_id: notice.team_id,
            computer_id: notice.computer_id,
            metadata: ComputerSetupMetadata {
                computer_id: notice.computer_id.as_uuid(),
                harness_id: notice
                    .computer
                    .harness_id
                    .map(|harness_id| harness_id.as_uuid()),
                computer_name: notice.computer.name,
                agent: Some(agent),
                outcome: ComputerSetupOutcome::Ready,
            },
            recipient: notice.inviter,
            // The computer's one ready notice, also if an older operator
            // already sent it when macrod connected.
            notification_id: notification_id(notice.computer_id, &SetupOutcome::Ready),
        })
        .await
        .map_err(TeamAgentError::internal)
    }
}

/// The same for every delivery of one outcome: the computer is ready once,
/// and each failed attempt fails at its own time.
fn notification_id(computer_id: ComputerId, outcome: &SetupOutcome) -> Uuid {
    let name = match outcome {
        SetupOutcome::Ready => format!("{computer_id}:ready"),
        SetupOutcome::Failed { failed_at, .. } => {
            format!("{computer_id}:failed:{}", failed_at.to_rfc3339())
        }
        SetupOutcome::Released { failed_at, .. } => {
            format!("{computer_id}:released:{}", failed_at.to_rfc3339())
        }
    };
    Uuid::new_v5(&NOTIFICATION_ID_NAMESPACE, name.as_bytes())
}
