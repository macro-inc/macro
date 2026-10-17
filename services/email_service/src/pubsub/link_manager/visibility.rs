use std::collections::HashSet;
use std::future::Future;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;
use tokio_util::task::AbortOnDropHandle;

#[cfg(test)]
mod test;

/// How far each heartbeat pushes out an in-flight message's visibility. Matches the
/// `email-service-refresh` queue's visibility timeout, so a crashed worker's messages
/// reappear within one timeout.
const VISIBILITY_TIMEOUT_SECONDS: i32 = 900;

/// Well under [`VISIBILITY_TIMEOUT_SECONDS`], so one failed heartbeat doesn't let a message
/// reappear while it is still being worked on.
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(300);

/// Keeps every message of a received batch invisible until the worker finishes it.
///
/// The batch is processed serially and a link delete can run far longer than the queue's
/// visibility timeout. Without the heartbeat the in-progress message, and every message
/// still waiting behind it, would be redelivered to another worker that runs the same
/// teardown again. Dropping this stops the heartbeat.
pub(crate) struct BatchVisibility {
    pending: Arc<Mutex<HashSet<String>>>,
    _heartbeat: AbortOnDropHandle<()>,
}

impl BatchVisibility {
    pub(crate) fn start(
        worker: &sqs_worker::SQSWorker,
        messages: &[aws_sdk_sqs::types::Message],
    ) -> Self {
        let worker = worker.clone();
        Self::start_with(
            messages
                .iter()
                .filter_map(|message| message.receipt_handle.clone()),
            HEARTBEAT_INTERVAL,
            move |receipt_handle| {
                let worker = worker.clone();
                async move {
                    worker
                        .change_message_visibility(&receipt_handle, VISIBILITY_TIMEOUT_SECONDS)
                        .await
                }
            },
        )
    }

    fn start_with<F, Fut>(
        receipt_handles: impl IntoIterator<Item = String>,
        interval: Duration,
        extend: F,
    ) -> Self
    where
        F: Fn(String) -> Fut + Send + 'static,
        Fut: Future<Output = anyhow::Result<()>> + Send + 'static,
    {
        let pending = Arc::new(Mutex::new(receipt_handles.into_iter().collect()));
        let ticker = tokio::time::interval_at(tokio::time::Instant::now() + interval, interval);
        let heartbeat = tokio::spawn(heartbeat(pending.clone(), ticker, extend));
        Self {
            pending,
            _heartbeat: AbortOnDropHandle::new(heartbeat),
        }
    }

    /// Stops extending `message`. Call once the worker is done with it, whether it was
    /// deleted from the queue or left to be retried after its current visibility lapses.
    pub(crate) fn finish(&self, message: &aws_sdk_sqs::types::Message) {
        if let Some(receipt_handle) = &message.receipt_handle {
            self.pending
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .remove(receipt_handle);
        }
    }
}

async fn heartbeat<F, Fut>(
    pending: Arc<Mutex<HashSet<String>>>,
    mut ticker: tokio::time::Interval,
    extend: F,
) where
    F: Fn(String) -> Fut,
    Fut: Future<Output = anyhow::Result<()>>,
{
    loop {
        ticker.tick().await;
        let receipt_handles: Vec<String> = pending
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .iter()
            .cloned()
            .collect();
        for receipt_handle in receipt_handles {
            extend(receipt_handle)
                .await
                .inspect_err(|e| {
                    tracing::warn!(error=?e, "failed to extend link manager message visibility");
                })
                .ok();
        }
    }
}
