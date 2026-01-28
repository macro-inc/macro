//! Worker for processing queued notifications.
//!
//! This module handles delivery of notifications that have been validated
//! and persisted. The main work (rate limiting, filtering) is done pre-queue,
//! so this worker focuses on delivery.

use rootcause::Report;
use tracing::instrument;

use crate::domain::ports::{
    EmailSender, NotificationQueue, NotificationRepository, NotificationSender, RateLimitPort,
    WebSocketSender,
};
use crate::domain::service::NotificationEgressService;

/// Worker that processes notifications from the queue and delivers them.
pub struct NotificationWorker<Q, N, W, M, E, R> {
    queue: Q,
    egress: NotificationEgressService<N, W, M, E, R>,
}

impl<Q, N, W, M, E, R> NotificationWorker<Q, N, W, M, E, R>
where
    Q: NotificationQueue,
    N: NotificationRepository,
    W: WebSocketSender,
    M: NotificationSender,
    E: EmailSender,
    R: RateLimitPort,
{
    /// Create a new notification worker.
    pub fn new(queue: Q, egress: NotificationEgressService<N, W, M, E, R>) -> Self {
        Self { queue, egress }
    }

    /// Run a single iteration of the worker loop.
    ///
    /// Receives messages from the queue, processes each one, and deletes
    /// successfully processed messages.
    ///
    /// Returns the number of messages successfully processed.
    #[instrument(skip(self), err)]
    pub async fn poll_and_process(&self) -> Result<usize, Report> {
        let messages = self.queue.receive_messages().await?;
        let count = messages.len();

        for message in messages {
            let receipt_handle = message.receipt_handle.clone();

            // Process the message through egress service
            let results = self.egress.deliver_notification(message.body).await;

            // Check if any delivery failed
            let has_failure = results.iter().any(|r| r.is_err());

            if has_failure {
                // Log failures - message will be retried via visibility timeout
                for result in &results {
                    if let Err(e) = result {
                        tracing::error!(error = ?e, "failed to deliver notification");
                    }
                }
            } else {
                // All deliveries succeeded, delete from queue
                if let Err(e) = self.queue.delete_message(&receipt_handle).await {
                    tracing::error!(error = ?e, "failed to delete message from queue");
                }
            }
        }

        Ok(count)
    }

    /// Run the worker loop continuously.
    ///
    /// This method runs forever, polling the queue and processing messages.
    /// It includes a small delay between empty polls to avoid hammering the queue.
    pub async fn run(&self) -> ! {
        loop {
            match self.poll_and_process().await {
                Ok(0) => {
                    // No messages, wait a bit before next poll
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
                Ok(count) => {
                    tracing::debug!(count, "processed messages");
                }
                Err(e) => {
                    tracing::error!(error = ?e, "worker poll failed");
                    // Wait before retrying after error
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                }
            }
        }
    }
}
