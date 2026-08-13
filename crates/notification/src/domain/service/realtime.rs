//! WebSocket notification consumer orchestration.

#[cfg(test)]
mod test;

use std::{borrow::Cow, num::NonZeroUsize, sync::Arc, time::Duration};

use broadcast::{BroadcastManager, GlobalSpawner};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::prelude::{Report, ResultExt as _};
use tokio_retry::{Retry, strategy::ExponentialBackoff};

use crate::domain::{
    models::{
        NotificationDelete, NotificationSubscriptionUpdate, PatchDelete, UserNotificationRow,
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
        BroadcastManager<GlobalSpawner, MacroUserIdStr<'static>, NotificationSubscriptionUpdate<T>>,
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

    /// Subscribes to notification updates owned by `user_id`.
    ///
    /// The returned subscription reports if its buffer fills, ensuring a slow subscriber cannot
    /// delay the shared consumer or other subscribers.
    #[must_use]
    pub fn subscribe(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> WebSocketNotificationSubscription<NotificationSubscriptionUpdate<T>> {
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

    /// Publishes one update to every active subscriber for `user_id`.
    fn publish_update(
        &self,
        user_id: &MacroUserIdStr<'static>,
        update: NotificationSubscriptionUpdate<T>,
    ) {
        match self.broadcasts.publish(user_id, update) {
            Ok(subscriber_count) => tracing::trace!(
                subscriber_count,
                user_id = %user_id,
                "distributed WebSocket notification update"
            ),
            Err(_) => tracing::trace!(
                user_id = %user_id,
                "dropping WebSocket notification update without subscribers"
            ),
        }
    }

    /// Converts a topic patch or deletion into a subscriber update.
    fn subscription_update(
        update: PatchDelete<uuid::Uuid, Cow<'static, UserNotificationRow<T>>>,
    ) -> NotificationSubscriptionUpdate<T> {
        match update {
            PatchDelete::Patch { diff } => {
                NotificationSubscriptionUpdate::Updated(Arc::new(diff.into_owned()))
            }
            PatchDelete::Delete { id } => NotificationSubscriptionUpdate::Deleted(id),
        }
    }

    /// Receives topic events and distributes WebSocket notification updates until reception fails.
    ///
    /// Callers should run this future in a supervised task. Updates for users without active
    /// subscribers are intentionally dropped.
    #[tracing::instrument(skip(self), err)]
    pub async fn run(&self) -> Result<(), Report> {
        loop {
            let event = Retry::start(receive_retry_strategy(), || self.consumer.recv())
                .await
                .context(format!(
                    "failed to receive notification topic event after {MAX_RECEIVE_ATTEMPTS} attempts"
                ))?;

            match event {
                NotificationTopicEvent::WebSocketDeliveryRequested(
                    WebSocketNotificationMetadata { notifications },
                ) => {
                    for notification in notifications {
                        let owner_id = notification.owner_id.clone();
                        self.publish_update(
                            &owner_id,
                            NotificationSubscriptionUpdate::Updated(Arc::new(notification)),
                        );
                    }
                }
                NotificationTopicEvent::NotificationStatusUpdatedForUsers { users, update } => {
                    let NotificationDelete::Delete { id } = *update;
                    for user_id in users {
                        self.publish_update(&user_id, NotificationSubscriptionUpdate::Deleted(id));
                    }
                }
                NotificationTopicEvent::NotificationStatusesUpdatedForUser { user, updates } => {
                    for update in updates {
                        self.publish_update(&user, Self::subscription_update(update));
                    }
                }
            }
        }
    }
}

impl<C, T> WebSocketNotificationSubscriptionService<NotificationSubscriptionUpdate<T>>
    for WebSocketNotificationConsumerService<C, T>
where
    C: NotificationTopicEventConsumer<T>,
    T: Clone + Send + Sync + 'static,
{
    fn subscribe(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> WebSocketNotificationSubscription<NotificationSubscriptionUpdate<T>> {
        WebSocketNotificationConsumerService::subscribe(self, user_id)
    }
}
