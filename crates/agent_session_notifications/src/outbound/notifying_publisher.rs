//! An [`AgentSessionLifecyclePublisher`] that also notifies people.
//!
//! Wraps the harness's real publisher: every fact goes to it first, exactly
//! as before, and then whatever [`plan`] makes of the fact is sent to the
//! notification service through the same ingress the channel and GitHub
//! producers use. The harness composes this at its root and never learns
//! that notifications exist.

#[cfg(test)]
mod test;

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use agent_session::domain::events::AgentSessionLifecycleEvent;
use agent_session::domain::ports::AgentSessionLifecyclePublisher;
use notification::domain::service::NotificationIngress;

use crate::domain::plan::{PlannedNotification, plan};

/// Publishes lifecycle facts to `inner` and the notifications they warrant
/// to `ingress`.
pub struct NotifyingLifecyclePublisher<Inner, Ingress> {
    inner: Inner,
    ingress: Arc<Ingress>,
}

impl<Inner, Ingress> NotifyingLifecyclePublisher<Inner, Ingress> {
    /// Decorate `inner`, notifying through `ingress`.
    pub fn new(inner: Inner, ingress: Arc<Ingress>) -> Self {
        Self { inner, ingress }
    }
}

impl<Inner, Ingress> NotifyingLifecyclePublisher<Inner, Ingress>
where
    Ingress: NotificationIngress,
{
    /// Send one planned notification. A failure is logged and dropped: the
    /// fact itself already happened and was published, and the ingress is a
    /// queue whose own retries are the delivery guarantee once accepted.
    async fn notify(&self, notification: PlannedNotification) {
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
            tracing::warn!(error = ?error, kind, "failed to enqueue an agent session notification");
        }
    }
}

impl<Inner, Ingress> AgentSessionLifecyclePublisher for NotifyingLifecyclePublisher<Inner, Ingress>
where
    Inner: AgentSessionLifecyclePublisher,
    Ingress: NotificationIngress,
{
    fn publish(
        &self,
        event: AgentSessionLifecycleEvent,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(async move {
            let notifications = plan(&event);
            self.inner.publish(event).await;
            for notification in notifications {
                self.notify(notification).await;
            }
        })
    }
}
