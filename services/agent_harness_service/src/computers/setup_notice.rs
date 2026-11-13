//! The port that tells a computer's buyer how its first setup ended
//! (`hosted_runtimes::domain::ports::SetupNotices`): the `computer_setup`
//! notification, through the notification ingress. A computer bought for an
//! agent teammate tells the agent's inviter, by the agent's name.

#[cfg(test)]
mod test;

use std::collections::HashSet;
use std::sync::Arc;

use hosted_runtimes::domain::lifecycle::SetupOutcome;
use hosted_runtimes::domain::ports::{SetupNotice, SetupNotices};
use model_entity::EntityType;
use macro_user_id::user_id::MacroUserIdStr;
use model_notifications::{ComputerSetupAgent, ComputerSetupMetadata, ComputerSetupOutcome};
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::service::NotificationIngress;
use team_agents::domain::ports::TeamAgentRepository;
use uuid::Uuid;

/// The namespace setup notification ids are derived in, so every retry and
/// redelivery of one notice creates the same notification. Fixed forever.
const NOTIFICATION_ID_NAMESPACE: Uuid = Uuid::from_u128(0x6d61_6372_6f2d_636f_6d70_2d73_6574_7570);

/// The notification ingress refused a notice, or the agent it is about
/// could not be read.
#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct SetupNoticeError(rootcause::Report);

/// [`SetupNotices`] over the notification ingress, reading agent teammates
/// from `Agents`.
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

impl<Ingress: NotificationIngress, Agents: TeamAgentRepository> IngressSetupNotices<Ingress, Agents> {
    /// Who hears about the notice, and the agent it names: the buyer for a
    /// plain computer; for an agent teammate's, the agent's inviter. `None`
    /// when there is no one left to tell: the agent was removed, or its
    /// inviter's account is gone.
    async fn audience(
        &self,
        notice: &SetupNotice,
    ) -> Result<Option<(MacroUserIdStr<'static>, Option<ComputerSetupAgent>)>, SetupNoticeError>
    {
        let Some(agent_user_id) = &notice.agent else {
            return Ok(Some((notice.buyer.clone(), None)));
        };

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
        Ok(Some((inviter, Some(agent))))
    }
}

impl<Ingress: NotificationIngress, Agents: TeamAgentRepository> SetupNotices
    for IngressSetupNotices<Ingress, Agents>
{
    type Err = SetupNoticeError;

    async fn send(&self, notice: SetupNotice) -> Result<(), SetupNoticeError> {
        let Some((recipient, agent)) = self.audience(&notice).await? else {
            return Ok(());
        };

        let notification_id = notification_id(&notice);
        let request = SendNotificationRequestBuilder {
            notification_entity: EntityType::Team.with_entity_string(notice.team_id.to_string()),
            secondary_notification_entity: None,
            notification: ComputerSetupMetadata {
                computer_id: notice.computer_id.as_uuid(),
                harness_id: notice.harness_id.map(|harness_id| harness_id.as_uuid()),
                computer_name: notice.computer_name,
                agent,
                outcome: match notice.outcome {
                    SetupOutcome::Ready => ComputerSetupOutcome::Ready,
                    SetupOutcome::Failed { failure, .. } => ComputerSetupOutcome::Failed {
                        failure_reason: failure.reason().to_owned(),
                    },
                },
            },
            sender_id: None,
            recipient_ids: HashSet::from([recipient]),
        }
        .into_request_with_id(notification_id)
        .with_apns()
        .with_conn_gateway();
        self.ingress
            .send_notification(request)
            .await
            .map_err(|error| SetupNoticeError(error.into_dynamic()))?;
        Ok(())
    }
}

/// The same for every delivery of one outcome: the computer is ready once,
/// and each failed attempt fails at its own time.
fn notification_id(notice: &SetupNotice) -> Uuid {
    let name = match notice.outcome {
        SetupOutcome::Ready => format!("{}:ready", notice.computer_id),
        SetupOutcome::Failed { failed_at, .. } => {
            format!("{}:failed:{}", notice.computer_id, failed_at.to_rfc3339())
        }
    };
    Uuid::new_v5(&NOTIFICATION_ID_NAMESPACE, name.as_bytes())
}
