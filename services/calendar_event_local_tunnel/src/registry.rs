//! In-memory fan-out from webhook deliveries to SSE subscribers.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use calendar_watch_relay::RelayedWatchNotification;
use tokio::sync::broadcast;

/// Deliveries a slow subscriber may buffer before lagging. Lagged
/// notifications are dropped — the subscriber's poll remains the backstop.
const CHANNEL_CAPACITY: usize = 64;

/// Live subscriptions keyed by channel token.
///
/// Entries are reclaimed on the first publish after their last subscriber
/// disconnects; a token that subscribes and never receives a delivery keeps
/// one idle entry, which is bounded by the number of developers who ever
/// connected since the last deploy.
#[derive(Clone, Default)]
pub struct RelayRegistry {
    inner: Arc<Mutex<HashMap<String, broadcast::Sender<RelayedWatchNotification>>>>,
}

impl RelayRegistry {
    /// Deliver one notification to `token`'s subscribers, returning how many
    /// received it. A token with no live subscriber is dropped on the floor —
    /// that is exactly the stray case after a local stack is torn down.
    pub fn publish(&self, token: &str, notification: RelayedWatchNotification) -> usize {
        let mut inner = self.inner.lock().unwrap();
        let Some(sender) = inner.get(token) else {
            return 0;
        };
        match sender.send(notification) {
            Ok(receivers) => receivers,
            Err(_) => {
                inner.remove(token);
                0
            }
        }
    }

    /// Open one subscription for `token`.
    pub fn subscribe(&self, token: &str) -> broadcast::Receiver<RelayedWatchNotification> {
        self.inner
            .lock()
            .unwrap()
            .entry(token.to_owned())
            .or_insert_with(|| broadcast::channel(CHANNEL_CAPACITY).0)
            .subscribe()
    }
}

#[cfg(test)]
mod test;
