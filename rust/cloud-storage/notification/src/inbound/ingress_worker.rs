//! Worker for processing notification ingress messages from a queue.
//!
//! This worker picks up [`IngressQueueMessage`] messages from the ingress SQS
//! queue, deserializes them, and processes them through
//! [`NotificationIngressService::process_from_queue`].

use crate::domain::models::email_notification_digest::BulkDigestStateMachine;
use crate::domain::ports::{NotificationIngressQueue, NotificationQueue, NotificationRepository};
use crate::domain::service::NotificationIngressService;
use std::time::Duration;

/// Worker that processes notification requests from the ingress queue.
///
/// Polls the ingress queue for [`IngressQueueMessage`] messages, deserializes
/// them, and processes each through [`NotificationIngressService::process_from_queue`].
/// Successfully processed messages are deleted from the queue; failures are left
/// for SQS retry via visibility timeout.
pub struct IngressWorker<N, Q, S, IQ> {
    service: NotificationIngressService<N, Q, S>,
    queue: IQ,
}

impl<N, Q, S, IQ> IngressWorker<N, Q, S, IQ>
where
    N: NotificationRepository,
    Q: NotificationQueue,
    S: BulkDigestStateMachine,
    IQ: NotificationIngressQueue,
{
    /// Create a new ingress worker.
    pub fn new(service: NotificationIngressService<N, Q, S>, queue: IQ) -> Self {
        Self { service, queue }
    }

    /// Run the worker loop continuously.
    ///
    /// This method runs forever, polling the ingress queue and processing
    /// messages. It includes a small delay between empty polls to avoid
    /// hammering the queue.
    pub async fn run(&self) -> ! {
        loop {
            match self.queue.receive_messages().await {
                Ok(messages) if messages.is_empty() => {
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
                Ok(messages) => {
                    let count = messages.len();
                    for message in messages {
                        match tokio::time::timeout(
                            Duration::from_secs(15),
                            self.service.process_from_queue(message.body.request),
                        )
                        .await
                        {
                            Ok(Ok(_)) => {
                                if let Err(e) =
                                    self.queue.delete_message(&message.receipt_handle).await
                                {
                                    tracing::error!(error=?e, "failed to delete ingress message");
                                }
                            }
                            Err(timeout) => {
                                tracing::warn!("Exceeded processing timeout {timeout}");
                            }

                            Ok(Err(e)) => {
                                tracing::error!(error=?e, "failed to process ingress notification");
                            }
                        }
                    }
                    tracing::debug!(count, "processed ingress messages");
                }
                Err(e) => {
                    tracing::error!(error=?e, "failed to receive ingress messages");
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
            }
        }
    }
}
