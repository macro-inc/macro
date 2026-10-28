//! Sending analytics off the request path, with a cap on concurrent sends.

#[cfg(test)]
mod test;

use std::sync::Arc;

use tokio::{sync::Semaphore, task::JoinHandle};

use crate::AnalyticsClient;

/// Sends analytics on background tasks, at most `max_in_flight` at a time.
///
/// When that many sends are running, new ones are dropped rather than queued,
/// so a slow analytics provider never piles up tasks, sockets, or the lookups
/// a send makes before it posts.
#[derive(Clone)]
pub struct BackgroundSender {
    client: AnalyticsClient,
    in_flight: Arc<Semaphore>,
}

impl BackgroundSender {
    /// Sends through `client`, running at most `max_in_flight` sends at once.
    pub fn new(client: AnalyticsClient, max_in_flight: usize) -> Self {
        Self {
            client,
            in_flight: Arc::new(Semaphore::new(max_in_flight)),
        }
    }

    /// Runs `send` on a background task, or drops it when `max_in_flight`
    /// sends are already running. Returns the task when it was started.
    pub fn spawn<F, Fut>(&self, send: F) -> Option<JoinHandle<()>>
    where
        F: FnOnce(AnalyticsClient) -> Fut,
        Fut: Future<Output = ()> + Send + 'static,
    {
        let Ok(permit) = self.in_flight.clone().try_acquire_owned() else {
            tracing::debug!("dropped an analytics event: too many sends in flight");
            return None;
        };
        let send = send(self.client.clone());
        Some(tokio::spawn(async move {
            send.await;
            drop(permit);
        }))
    }
}
