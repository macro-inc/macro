//! WebSocket sender that fans each delivery out to two adapters.

#[cfg(test)]
mod test;

use std::collections::HashSet;

use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use serde::Serialize;

use crate::domain::ports::WebSocketSender;

/// WebSocket sender that delivers through two underlying senders.
///
/// Both sends are awaited concurrently. The delivery receipts are combined when both sends
/// succeed; an error from either sender fails the combined send after both attempts complete.
pub struct FanoutWebSocketSender<A, B> {
    first: A,
    second: B,
}

impl<A, B> FanoutWebSocketSender<A, B> {
    /// Creates a sender that fans each delivery out to `first` and `second`.
    pub fn new(first: A, second: B) -> Self {
        Self { first, second }
    }
}

impl<A: WebSocketSender, B: WebSocketSender> WebSocketSender for FanoutWebSocketSender<A, B> {
    #[tracing::instrument(err, skip_all, fields(recipient_count = recipients.len()))]
    async fn send_notifications<'a, T: Serialize + Send + Sync>(
        &self,
        recipients: &[MacroUserIdStr<'a>],
        notification: &T,
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        let (first, second) = futures::future::join(
            self.first.send_notifications(recipients, notification),
            self.second.send_notifications(recipients, notification),
        )
        .await;

        let mut delivered = first?;
        delivered.extend(second?);
        Ok(delivered)
    }
}
