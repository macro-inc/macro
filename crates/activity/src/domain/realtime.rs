//! Realtime distribution of recorded activities to user-scoped subscribers.
//!
//! Mirrors the WebSocket notification consumer: an independent (ungrouped)
//! topic consumer feeds a per-user broadcast, and each event is routed to
//! its addressed recipient only — recipients were resolved at publish time
//! (the acting subject plus the touched entities' current accessors), so no
//! access expansion happens here.

#[cfg(test)]
mod test;

use std::{num::NonZeroUsize, sync::Arc, time::Duration};

use broadcast::{BroadcastManager, GlobalSpawner};
use macro_user_id::cowlike::CowLike as _;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::prelude::{Report, ResultExt as _};
use tokio_retry::{Retry, strategy::ExponentialBackoff};

use super::events::ActivityTopicEvent;
use super::models::ActivityRecord;

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

/// One realtime activity update delivered to a subscriber.
#[derive(Debug, Clone)]
pub enum ActivitySubscriptionUpdate {
    /// An activity row was durably recorded.
    Updated(Arc<ActivityRecord>),
    /// A recorded activity was purged and must leave caches.
    Deleted(uuid::Uuid),
}

/// Why an activity subscription ended after its messages were drained.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ActivitySubscriptionExit {
    /// The subscription closed normally.
    Closed,
    /// The subscriber's bounded buffer filled.
    SlowConsumer,
    /// The subscriber fell behind the shared broadcast buffer.
    Lagging {
        /// Number of messages skipped by the broadcast receiver.
        skipped: u64,
    },
}

/// An activity update receiver with independently observable completion.
pub struct ActivitySubscription {
    receiver: tokio::sync::mpsc::Receiver<ActivitySubscriptionUpdate>,
    exit_reason: tokio::sync::oneshot::Receiver<ActivitySubscriptionExit>,
}

impl ActivitySubscription {
    /// Creates a subscription from its message and exit-reason receivers.
    pub fn from_parts(
        receiver: tokio::sync::mpsc::Receiver<ActivitySubscriptionUpdate>,
        exit_reason: tokio::sync::oneshot::Receiver<ActivitySubscriptionExit>,
    ) -> Self {
        Self {
            receiver,
            exit_reason,
        }
    }

    /// Receives the next buffered update.
    pub async fn recv(&mut self) -> Option<ActivitySubscriptionUpdate> {
        self.receiver.recv().await
    }

    /// Returns why the forwarding task stopped, after messages are drained.
    pub async fn exit_reason(self) -> ActivitySubscriptionExit {
        self.exit_reason
            .await
            .unwrap_or(ActivitySubscriptionExit::Closed)
    }
}

/// Provides user-scoped subscriptions to realtime activity updates.
pub trait ActivitySubscriptionService: Send + Sync + 'static {
    /// Subscribes to activity updates addressed to `user_id`.
    fn subscribe(&self, user_id: MacroUserIdStr<'static>) -> ActivitySubscription;
}

impl<S: ActivitySubscriptionService> ActivitySubscriptionService for Arc<S> {
    fn subscribe(&self, user_id: MacroUserIdStr<'static>) -> ActivitySubscription {
        self.as_ref().subscribe(user_id)
    }
}

/// No-op activity subscription service for schema-only consumers.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoOpActivitySubscriptionService;

impl ActivitySubscriptionService for NoOpActivitySubscriptionService {
    fn subscribe(&self, _user_id: MacroUserIdStr<'static>) -> ActivitySubscription {
        let (_sender, receiver) = tokio::sync::mpsc::channel(1);
        let (exit_reason_sender, exit_reason) = tokio::sync::oneshot::channel();
        let _ = exit_reason_sender.send(ActivitySubscriptionExit::Closed);
        ActivitySubscription::from_parts(receiver, exit_reason)
    }
}

/// Receives events from the activity topic.
pub trait ActivityTopicEventConsumer: Send + Sync + 'static {
    /// Waits for and returns the next activity topic event.
    fn recv(&self) -> impl Future<Output = Result<ActivityTopicEvent, Report>> + Send;
}

/// Service distributing received activity rows to user-scoped subscribers.
pub struct ActivityRealtimeConsumerService<C> {
    consumer: C,
    broadcasts:
        BroadcastManager<GlobalSpawner, MacroUserIdStr<'static>, ActivitySubscriptionUpdate>,
}

impl<C: ActivityTopicEventConsumer> ActivityRealtimeConsumerService<C> {
    /// Creates an activity realtime consumer service backed by `consumer`.
    pub fn new(consumer: C) -> Self {
        Self {
            consumer,
            broadcasts: BroadcastManager::new(GlobalSpawner, BROADCAST_BUFFER_CAPACITY),
        }
    }

    /// Subscribes to activity updates addressed to `user_id`.
    ///
    /// The returned subscription reports if its buffer fills, so a slow
    /// subscriber cannot delay the shared consumer or other subscribers.
    #[must_use]
    pub fn subscribe(&self, user_id: MacroUserIdStr<'static>) -> ActivitySubscription {
        let (receiver, broadcast_exit_reason) = self
            .broadcasts
            .subscribe(user_id, SUBSCRIBER_BUFFER_CAPACITY)
            .into_parts();
        let (exit_reason_sender, exit_reason) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            let reason = match broadcast_exit_reason.await {
                Ok(broadcast::ExitReason::SlowConsumer) => ActivitySubscriptionExit::SlowConsumer,
                Ok(broadcast::ExitReason::Lagging { skipped }) => {
                    ActivitySubscriptionExit::Lagging { skipped }
                }
                Ok(broadcast::ExitReason::ReceiverClosed | broadcast::ExitReason::SenderClosed)
                | Err(_) => ActivitySubscriptionExit::Closed,
            };
            let _ = exit_reason_sender.send(reason);
        });
        ActivitySubscription::from_parts(receiver, exit_reason)
    }

    /// Receives topic events and distributes updates until reception fails.
    ///
    /// Callers should run this future in a supervised task. Updates for
    /// users without active subscribers are intentionally dropped, as are
    /// events addressed to non-user principals (nothing can subscribe as a
    /// bot). Rows keep whatever subject they carry — entity watchers receive
    /// other principals' rows, bot subjects included.
    #[tracing::instrument(skip(self), err)]
    pub async fn run(&self) -> Result<(), Report> {
        loop {
            let event = Retry::start(receive_retry_strategy(), || self.consumer.recv())
                .await
                .context(format!(
                    "failed to receive activity topic event after {MAX_RECEIVE_ATTEMPTS} attempts"
                ))?;

            let ActivityTopicEvent::Recorded {
                recipient_id,
                activities,
            } = event;
            let Ok(recipient) = MacroUserIdStr::parse_from_str(&recipient_id) else {
                continue;
            };
            let recipient = recipient.into_owned();
            for row in activities {
                let Some(record) = row.into_record() else {
                    continue;
                };
                match self.broadcasts.publish(
                    &recipient,
                    ActivitySubscriptionUpdate::Updated(Arc::new(record)),
                ) {
                    Ok(subscriber_count) => tracing::trace!(
                        subscriber_count,
                        recipient = %recipient,
                        "distributed activity update"
                    ),
                    Err(_) => tracing::trace!(
                        recipient = %recipient,
                        "dropping activity update without subscribers"
                    ),
                }
            }
        }
    }
}

impl<C: ActivityTopicEventConsumer> ActivitySubscriptionService
    for ActivityRealtimeConsumerService<C>
{
    fn subscribe(&self, user_id: MacroUserIdStr<'static>) -> ActivitySubscription {
        ActivityRealtimeConsumerService::subscribe(self, user_id)
    }
}
