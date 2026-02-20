//! Worker for processing SNS push notification platform events.
//!
//! This module handles events like delivery failures and endpoint deletions
//! by polling an SQS queue and delegating to the push notification event service.

use crate::domain::models::push_notification_event::SnsPushNotificationEvent;
use crate::domain::ports::PushNotificationEventQueue;
use crate::domain::service::PushNotificationEventHandler;

/// Worker that processes push notification platform events from a queue.
///
/// This is a thin wrapper that runs the poll loop continuously,
/// deserializing messages and delegating to a [`PushNotificationEventHandler`].
pub struct PushNotificationEventWorker<S, Q> {
    service: S,
    queue: Q,
}

impl<S, Q> PushNotificationEventWorker<S, Q>
where
    S: PushNotificationEventHandler,
    Q: PushNotificationEventQueue,
{
    /// Create a new push notification event worker.
    pub fn new(service: S, queue: Q) -> Self {
        Self { service, queue }
    }

    /// Run the worker loop continuously.
    ///
    /// This method runs forever, polling the queue and processing messages.
    /// Errors on individual messages are logged but do not stop the worker.
    pub async fn run(&self) -> ! {
        tracing::info!("starting push notification event worker");
        loop {
            if let Ok(messages) = self.queue.receive_messages().await {
                if messages.is_empty() {
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                    continue;
                }

                for message in &messages {
                    let Some(body) = message.body.as_ref() else {
                        tracing::warn!("received message with no body, skipping");
                        continue;
                    };

                    let event: SnsPushNotificationEvent = match serde_json::from_str(body) {
                        Ok(event) => event,
                        Err(e) => {
                            tracing::error!(error=?e, "failed to deserialize push notification event");
                            continue;
                        }
                    };

                    if self.service.handle_event(&event).await.is_err() {
                        continue;
                    }

                    if let Some(receipt_handle) = message.receipt_handle.as_ref() {
                        let _ = self.queue.delete_message(receipt_handle).await;
                    }
                }
            }
        }
    }
}
