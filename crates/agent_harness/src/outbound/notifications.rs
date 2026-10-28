//! Send agent-session notifications through the notification ingress.
//!
//! The same queue every other producer notifies through: the request is
//! serialized onto the ingress SQS queue and `notification_service` creates
//! the rows, fans out realtime, and pushes. A send failure is logged and
//! dropped - the lifecycle fact already happened and was published, and the
//! ingress queue's own retries are the delivery guarantee once accepted.

#[cfg(test)]
mod test;

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use notification::domain::service::NotificationIngress;

use crate::domain::notifications::PlannedNotification;
use crate::domain::ports::AgentSessionNotifier;

/// [`AgentSessionNotifier`] over a [`NotificationIngress`].
pub struct IngressAgentSessionNotifier<Ingress> {
    ingress: Arc<Ingress>,
}

impl<Ingress> IngressAgentSessionNotifier<Ingress> {
    /// Notify through `ingress`.
    pub fn new(ingress: Arc<Ingress>) -> Self {
        Self { ingress }
    }
}

impl<Ingress> AgentSessionNotifier for IngressAgentSessionNotifier<Ingress>
where
    Ingress: NotificationIngress,
{
    fn notify(
        &self,
        notification: PlannedNotification,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(async move {
            let kind = notification.kind();
            let result = match notification {
                PlannedNotification::Settled(notify) => {
                    self.ingress.send_notification(notify.into_request()).await
                }
                PlannedNotification::WaitingForInput(notify) => {
                    self.ingress.send_notification(notify.into_request()).await
                }
                PlannedNotification::Mentioned(notify) => {
                    self.ingress.send_notification(notify.into_request()).await
                }
            };
            if let Err(error) = result {
                tracing::warn!(
                    error = ?error,
                    kind,
                    "failed to enqueue an agent session notification"
                );
            }
        })
    }
}
