//! The port that tells a computer's buyer how its first setup ended
//! (`hosted_runtimes::domain::ports::SetupNotices`): the `computer_setup`
//! notification, through the notification ingress.

#[cfg(test)]
mod test;

use std::collections::HashSet;
use std::sync::Arc;

use hosted_runtimes::domain::lifecycle::SetupOutcome;
use hosted_runtimes::domain::ports::{SetupNotice, SetupNotices};
use model_entity::EntityType;
use model_notifications::{ComputerSetupMetadata, ComputerSetupOutcome};
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::service::NotificationIngress;
use uuid::Uuid;

/// The namespace setup notification ids are derived in, so every retry and
/// redelivery of one notice creates the same notification. Fixed forever.
const NOTIFICATION_ID_NAMESPACE: Uuid = Uuid::from_u128(0x6d61_6372_6f2d_636f_6d70_2d73_6574_7570);

/// The notification ingress refused a notice.
#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct SetupNoticeError(rootcause::Report);

/// [`SetupNotices`] over the notification ingress.
pub struct IngressSetupNotices<Ingress> {
    ingress: Arc<Ingress>,
}

impl<Ingress> IngressSetupNotices<Ingress> {
    /// Send through `ingress`.
    pub fn new(ingress: Arc<Ingress>) -> Self {
        Self { ingress }
    }
}

impl<Ingress: NotificationIngress> SetupNotices for IngressSetupNotices<Ingress> {
    type Err = SetupNoticeError;

    async fn send(&self, notice: SetupNotice) -> Result<(), SetupNoticeError> {
        let notification_id = notification_id(&notice);
        let request = SendNotificationRequestBuilder {
            notification_entity: EntityType::Team.with_entity_string(notice.team_id.to_string()),
            secondary_notification_entity: None,
            notification: ComputerSetupMetadata {
                computer_id: notice.computer_id.as_uuid(),
                harness_id: notice.harness_id.map(|harness_id| harness_id.as_uuid()),
                computer_name: notice.computer_name,
                outcome: match notice.outcome {
                    SetupOutcome::Ready => ComputerSetupOutcome::Ready,
                    SetupOutcome::Failed { failure, .. } => ComputerSetupOutcome::Failed {
                        failure_reason: failure.reason().to_owned(),
                    },
                },
            },
            sender_id: None,
            recipient_ids: HashSet::from([notice.buyer]),
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
