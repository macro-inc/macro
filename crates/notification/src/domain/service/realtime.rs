//! WebSocket notification consumer orchestration.

#[cfg(test)]
mod test;

use std::{num::NonZeroUsize, sync::Arc, time::Duration};

use broadcast::{BroadcastManager, GlobalSpawner};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::prelude::{Report, ResultExt as _};
use tokio_retry::{Retry, strategy::ExponentialBackoff};

use crate::domain::{
    models::{
        UserNotificationRow,
        websocket_notification_event::{NotificationTopicEvent, WebSocketNotificationMetadata},
    },
    ports::{
        NotificationTopicEventConsumer, WebSocketNotificationSubscription,
        WebSocketNotificationSubscriptionService,
    },
};

/// Number of messages retained by each user-keyed broadcast channel.
const BROADCAST_BUFFER_CAPACITY: NonZeroUsize = NonZeroUsize::new(64).unwrap();
/// Number of messages buffered for each individual subscriber.
const SUBSCRIBER_BUFFER_CAPACITY: NonZeroUsize = NonZeroUsize::new(16).unwrap();
/// Total receive attempts before the consumer returns for supervision.
const MAX_RECEIVE_ATTEMPTS: usize = 5;

/// Retries after one, two, four, and eight seconds.
fn receive_retry_strategy() -> impl Iterator<Item = Duration> {
    ExponentialBackoff::from_millis(2)
        .factor(500)
        .take(MAX_RECEIVE_ATTEMPTS - 1)
}

/// Service for distributing received notification rows to user-scoped subscribers.
pub struct WebSocketNotificationConsumerService<C, T>
where
    C: NotificationTopicEventConsumer<T>,
    T: Clone + Send + Sync + 'static,
{
    consumer: C,
    broadcasts:
        BroadcastManager<GlobalSpawner, MacroUserIdStr<'static>, Arc<UserNotificationRow<T>>>,
}

impl<C, T> WebSocketNotificationConsumerService<C, T>
where
    C: NotificationTopicEventConsumer<T>,
    T: Clone + Send + Sync + 'static,
{
    /// Creates a WebSocket notification consumer service backed by `consumer`.
    pub fn new(consumer: C) -> Self {
        Self {
            consumer,
            broadcasts: BroadcastManager::new(GlobalSpawner, BROADCAST_BUFFER_CAPACITY),
        }
    }

    /// Subscribes to notification rows owned by `user_id`.
    ///
    /// The returned subscription reports if its buffer fills, ensuring a slow subscriber cannot
    /// delay the shared consumer or other subscribers.
    #[must_use]
    pub fn subscribe(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> WebSocketNotificationSubscription<Arc<UserNotificationRow<T>>> {
        let (receiver, broadcast_exit_reason) = self
            .broadcasts
            .subscribe(user_id, SUBSCRIBER_BUFFER_CAPACITY)
            .into_parts();
        let (exit_reason_sender, exit_reason) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            use crate::domain::ports::WebSocketNotificationSubscriptionExit;

            let reason = match broadcast_exit_reason.await {
                Ok(broadcast::ExitReason::SlowConsumer) => {
                    WebSocketNotificationSubscriptionExit::SlowConsumer
                }
                Ok(broadcast::ExitReason::Lagging { skipped }) => {
                    WebSocketNotificationSubscriptionExit::Lagging { skipped }
                }
                Ok(broadcast::ExitReason::ReceiverClosed | broadcast::ExitReason::SenderClosed)
                | Err(_) => WebSocketNotificationSubscriptionExit::Closed,
            };
            let _ = exit_reason_sender.send(reason);
        });
        WebSocketNotificationSubscription::from_parts(receiver, exit_reason)
    }

    /// Receives topic events and distributes WebSocket notification rows until reception fails.
    ///
    /// Callers should run this future in a supervised task. Non-WebSocket topic events and
    /// notification rows for users without active subscribers are intentionally dropped.
    #[tracing::instrument(skip(self), err)]
    pub async fn run(&self) -> Result<(), Report> {
        loop {
            let event = Retry::start(receive_retry_strategy(), || self.consumer.recv())
                .await
                .context(format!(
                    "failed to receive notification topic event after {MAX_RECEIVE_ATTEMPTS} attempts"
                ))?;
            let NotificationTopicEvent::WebSocketDeliveryRequested(WebSocketNotificationMetadata {
                notifications,
            }) = event
            else {
                continue;
            };

            for notification in notifications {
                let owner_id = notification.owner_id.clone();
                match self.broadcasts.publish(&owner_id, Arc::new(notification)) {
                    Ok(subscriber_count) => tracing::trace!(
                        subscriber_count,
                        user_id = %owner_id,
                        "distributed WebSocket notification"
                    ),
                    Err(_) => tracing::trace!(
                        user_id = %owner_id,
                        "dropping WebSocket notification without subscribers"
                    ),
                }
            }
        }
    }
}

impl<C, T> WebSocketNotificationSubscriptionService<UserNotificationRow<T>>
    for WebSocketNotificationConsumerService<C, T>
where
    C: NotificationTopicEventConsumer<T>,
    T: Clone + Send + Sync + 'static,
{
    fn subscribe(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> WebSocketNotificationSubscription<Arc<UserNotificationRow<T>>> {
        WebSocketNotificationConsumerService::subscribe(self, user_id)
    }
}
