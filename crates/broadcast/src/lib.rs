//! Instance-local keyed asynchronous fan-out.
//!
//! [`BroadcastManager`] maintains one Tokio broadcast channel per active key.
//! Each subscription is exposed as a bounded MPSC receiver so a slow subscriber
//! can be disconnected without delaying publishers or other subscribers.

#![deny(missing_docs)]

use dashmap::DashMap;
use std::{hash::Hash, num::NonZeroUsize, sync::Arc};
use tokio::task::JoinHandle;
use tokio_util::task::TaskTracker;

#[cfg(test)]
mod test;

/// Spawns forwarding tasks used by a [`BroadcastManager`].
pub trait Spawner {
    /// Spawns `future` and returns a handle to the resulting task.
    fn spawn<F>(&self, future: F) -> JoinHandle<F::Output>
    where
        F: Future + Send + 'static,
        F::Output: Send + 'static;
}

/// A [`Spawner`] that uses the current Tokio runtime without tracking tasks.
#[derive(Debug, Clone, Copy)]
pub struct GlobalSpawner;

impl Spawner for GlobalSpawner {
    fn spawn<F>(&self, future: F) -> JoinHandle<F::Output>
    where
        F: Future + Send + 'static,
        F::Output: Send + 'static,
    {
        tokio::spawn(future)
    }
}

impl Spawner for TaskTracker {
    fn spawn<F>(&self, future: F) -> JoinHandle<F::Output>
    where
        F: Future + Send + 'static,
        F::Output: Send + 'static,
    {
        TaskTracker::spawn(self, future)
    }
}

/// Publishes values to subscribers grouped by a key.
///
/// A separate Tokio broadcast channel is created for each active key. The
/// channel is removed as soon as its last forwarding task exits, so keys do not
/// accumulate after their subscribers disconnect.
pub struct BroadcastManager<T, K, V> {
    spawner: T,
    broadcast_buffer: NonZeroUsize,
    channels: Arc<DashMap<K, tokio::sync::broadcast::Sender<V>>>,
}

/// The reason a broadcast subscription's forwarding task stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExitReason {
    /// The subscription receiver was dropped by its consumer.
    ReceiverClosed,
    /// The keyed broadcast sender was closed.
    SenderClosed,
    /// The subscriber's bounded buffer filled.
    SlowConsumer,
    /// The subscriber fell behind the shared broadcast buffer.
    Lagging {
        /// Number of messages skipped by the broadcast receiver.
        skipped: u64,
    },
}

/// A bounded broadcast subscription and its independently reported exit reason.
pub struct BroadcastSubscription<V> {
    receiver: tokio::sync::mpsc::Receiver<V>,
    exit_reason: tokio::sync::oneshot::Receiver<ExitReason>,
}

impl<V> BroadcastSubscription<V> {
    /// Creates a subscription from its message and exit-reason receivers.
    pub fn from_parts(
        receiver: tokio::sync::mpsc::Receiver<V>,
        exit_reason: tokio::sync::oneshot::Receiver<ExitReason>,
    ) -> Self {
        Self {
            receiver,
            exit_reason,
        }
    }

    /// Splits the subscription into independently observable message and exit-reason receivers.
    pub fn into_parts(
        self,
    ) -> (
        tokio::sync::mpsc::Receiver<V>,
        tokio::sync::oneshot::Receiver<ExitReason>,
    ) {
        (self.receiver, self.exit_reason)
    }

    /// Returns only the message receiver, discarding exit-reason reporting.
    pub fn into_receiver(self) -> tokio::sync::mpsc::Receiver<V> {
        self.receiver
    }

    /// Receives the next buffered value.
    pub async fn recv(&mut self) -> Option<V> {
        self.receiver.recv().await
    }

    /// Attempts to receive the next buffered value without waiting.
    pub fn try_recv(&mut self) -> Result<V, tokio::sync::mpsc::error::TryRecvError> {
        self.receiver.try_recv()
    }
}

/// An error returned when a value has no active subscribers.
#[derive(Debug)]
pub struct NoSubscribers<V>(
    /// The inner value which failed to send
    pub V,
);

impl<K, V, T> BroadcastManager<T, K, V>
where
    K: Hash + Eq + Clone + Send + Sync + 'static,
    V: Clone + Send + 'static,
    T: Spawner,
{
    /// Creates a manager with the given per-key broadcast buffer capacity.
    pub fn new(spawner: T, broadcast_buffer: NonZeroUsize) -> Self {
        Self {
            spawner,
            broadcast_buffer,
            channels: Arc::new(DashMap::new()),
        }
    }

    /// Subscribes to values published for `key`.
    ///
    /// `subscriber_buffer` controls the capacity of the returned MPSC
    /// receiver. If that buffer fills, the forwarding task treats the
    /// subscriber as a slow consumer, disconnects it, and closes the receiver
    /// after its buffered values have been drained.
    #[must_use]
    pub fn subscribe(&self, key: K, subscriber_buffer: NonZeroUsize) -> BroadcastSubscription<V> {
        let (subscriber_tx, subscriber_rx) = tokio::sync::mpsc::channel(subscriber_buffer.get());
        let (exit_reason_tx, exit_reason_rx) = tokio::sync::oneshot::channel();

        let entry = self
            .channels
            .entry(key.clone())
            .or_insert_with(|| tokio::sync::broadcast::Sender::new(self.broadcast_buffer.get()));
        let mut broadcast_rx = entry.subscribe();
        drop(entry);

        let channels = Arc::downgrade(&self.channels);
        let _join_handle = self.spawner.spawn(async move {
            let reason = loop {
                tokio::select! {
                    () = subscriber_tx.closed() => {
                        break ExitReason::ReceiverClosed;
                    }
                    message = broadcast_rx.recv() => {
                        match message {
                            Ok(value) => match subscriber_tx.try_send(value) {
                                Ok(()) => {}
                                Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => {
                                    break ExitReason::SlowConsumer;
                                }
                                Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => {
                                    break ExitReason::ReceiverClosed;
                                }
                            },
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                                break ExitReason::Lagging { skipped };
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                                break ExitReason::SenderClosed;
                            }
                        }
                    }
                }
            };

            drop(broadcast_rx);
            if let Some(channels) = channels.upgrade() {
                channels.remove_if(&key, |_key, sender| sender.receiver_count() == 0);
            }

            match reason {
                ExitReason::Lagging { skipped } => {
                    tracing::debug!(
                        skipped,
                        "broadcast subscriber task exited because it lagged"
                    );
                }
                reason => {
                    tracing::debug!(?reason, "broadcast subscriber task exited");
                }
            }
            let _ = exit_reason_tx.send(reason);
        });

        BroadcastSubscription::from_parts(subscriber_rx, exit_reason_rx)
    }

    /// Publishes `value` to every active subscriber for `key`.
    ///
    /// The returned count is the number of subscribers present when the value
    /// was published. It does not guarantee that every subscriber processes the
    /// value; slow subscribers can subsequently be disconnected.
    pub fn publish(&self, key: &K, value: V) -> Result<usize, NoSubscribers<V>> {
        let Some(sender) = self.channels.get(key) else {
            return Err(NoSubscribers(value));
        };

        sender.send(value).map_err(|error| NoSubscribers(error.0))
    }

    /// Returns the current number of subscribers for `key`.
    ///
    /// The count can briefly include a subscriber whose returned MPSC receiver
    /// was just dropped but whose forwarding task has not yet observed closure.
    pub fn subscriber_count(&self, key: &K) -> usize {
        self.channels
            .get(key)
            .map_or(0, |sender| sender.receiver_count())
    }
}

impl<K, V> BroadcastManager<TaskTracker, K, V> {
    /// Closes every keyed channel and waits for all forwarding tasks to exit.
    ///
    /// The task tracker supplied to this manager should not also track unrelated
    /// tasks because shutdown closes and waits for the entire tracker.
    pub async fn shutdown(self) {
        let Self {
            channels, spawner, ..
        } = self;
        drop(channels);
        spawner.close();
        spawner.wait().await;
    }
}
