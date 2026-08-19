//! Notification realtime publisher that fans each update out to two adapters.

#[cfg(test)]
mod test;

use rootcause::Report;

use crate::domain::models::NotificationStatusPayload;
use crate::domain::ports::NotificationRealtimePublisher;

/// Notification realtime publisher that publishes through two underlying adapters.
///
/// Both publishes are awaited concurrently. An error from either publisher fails the combined
/// publish after both attempts complete.
pub struct FanoutNotificationRealtimePublisher<A, B> {
    first: A,
    second: B,
}

impl<A, B> FanoutNotificationRealtimePublisher<A, B> {
    /// Creates a publisher that fans each update out to `first` and `second`.
    pub fn new(first: A, second: B) -> Self {
        Self { first, second }
    }
}

impl<A, B> NotificationRealtimePublisher for FanoutNotificationRealtimePublisher<A, B>
where
    A: NotificationRealtimePublisher,
    B: NotificationRealtimePublisher,
{
    #[tracing::instrument(err, skip_all)]
    async fn publish_updates(&self, payload: &NotificationStatusPayload<'_>) -> Result<(), Report> {
        let (first, second) = futures::future::join(
            self.first.publish_updates(payload),
            self.second.publish_updates(payload),
        )
        .await;

        first?;
        second
    }
}
