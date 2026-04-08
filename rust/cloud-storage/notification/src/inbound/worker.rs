//! Worker for processing queued notifications.
//!
//! This module handles delivery of notifications that have been validated
//! and persisted. The main work (rate limiting, filtering) is done pre-queue,
//! so this worker focuses on delivery.

use std::time::Duration;

use rootcause::Report;

use crate::domain::{
    models::{
        NotificationExtEmail,
        email_notification_digest::ports::{ClaimResult, DigestBatch},
    },
    ports::NotificationEgress,
};

/// Worker that processes notifications from the queue and delivers them.
///
/// This is a thin wrapper around a `NotificationEgress` implementation that
/// runs the poll loop continuously.
pub struct NotificationWorker<S> {
    service: S,
}

impl<S> NotificationWorker<S>
where
    S: NotificationEgress,
{
    /// Create a new notification worker.
    pub fn new(service: S) -> Self {
        Self { service }
    }

    /// Run a single iteration of the worker loop.
    ///
    /// Polls the queue and delivers notifications. Returns the number of
    /// delivery results (may include failures).
    async fn poll_and_process_notifications(&self) -> usize {
        let results = self.service.poll_and_deliver().await;
        let count = results.len();

        // Log any failures
        for result in &results {
            if let Err(e) = result {
                tracing::error!(error = ?e.preformat(), "failed to deliver notification");
            }
        }

        count
    }

    /// Run the worker loop continuously.
    ///
    /// This method runs forever, polling the queue and processing messages.
    /// It includes a small delay between empty polls to avoid hammering the queue.
    pub async fn run_notifications(&self) -> ! {
        loop {
            let count = self.poll_and_process_notifications().await;

            if count == 0 {
                // No messages, wait a bit before next poll
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            } else {
                tracing::debug!(count, "processed delivery results");
            }
        }
    }

    /// runs the digest worker forever which will pick digest batch messages out of redis
    /// template them into emails via the templater fn f
    /// then place the formatted messages into the queue to be delievered
    pub async fn run_digests<
        T: NotificationExtEmail,
        F: Fn(DigestBatch) -> Result<T, Report> + Send + Sync + 'static,
    >(
        &self,
        f: F,
    ) -> ! {
        loop {
            let sleep_duration = match self.service.poll_email_digests(&f).await {
                Ok(ClaimResult::Empty) => Duration::from_secs(5),
                Ok(ClaimResult::Wait(duration)) => duration,
                Ok(ClaimResult::Ready(())) => Duration::default(),
                Err(_) => Duration::from_secs(1),
            };
            tokio::time::sleep(sleep_duration).await;
        }
    }
}
