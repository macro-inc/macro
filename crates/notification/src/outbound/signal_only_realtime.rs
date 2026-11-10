//! Realtime sender for a transport whose clients cannot tell lanes apart.

#[cfg(test)]
mod test;

use std::collections::HashSet;

use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use serde::Serialize;

use crate::domain::models::NotificationLane;
use crate::domain::models::queue_message::RealtimeNotif;
use crate::domain::ports::RealtimeSender;

/// Realtime sender that passes signal notifications to `inner` and drops the
/// rest.
///
/// Clients of the connection gateway's `notification` message play a sound and
/// raise an alert for every one they receive, including clients released
/// before lanes existed. Noise reaches the Noise view through the
/// notifications topic instead.
pub struct SignalOnlyRealtimeSender<S> {
    inner: S,
}

impl<S> SignalOnlyRealtimeSender<S> {
    /// Creates a sender that delivers only signal notifications through `inner`.
    pub fn new(inner: S) -> Self {
        Self { inner }
    }
}

impl<S: RealtimeSender> RealtimeSender for SignalOnlyRealtimeSender<S> {
    async fn send_notifications<'a, T: Serialize + Send + Sync>(
        &self,
        recipients: &[MacroUserIdStr<'a>],
        notification: &RealtimeNotif<T>,
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        match notification.lane {
            NotificationLane::Signal => {
                self.inner
                    .send_notifications(recipients, notification)
                    .await
            }
            NotificationLane::Noise => Ok(HashSet::new()),
        }
    }
}
