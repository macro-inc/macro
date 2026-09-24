//! Worker for processing notification ingress messages from a queue.
//!
//! This worker picks up [`IngressQueueMessage`] messages from the ingress SQS
//! queue, deserializes them, and processes them through
//! [`NotificationIngressService::process_from_queue`].

use crate::domain::models::email_notification_digest::BulkDigestStateMachine;
use crate::domain::ports::{
    NotificationDeliveryRepository, NotificationIngressQueue, NotificationQueue,
    NotificationRepository,
};
use crate::domain::service::NotificationIngressService;
use std::time::Duration;

const INGRESS_PROCESSING_TIMEOUT: Duration = Duration::from_secs(15);
const RECOVERY_BATCH_TIMEOUT: Duration = Duration::from_secs(15);
const RECOVERY_INTERVAL: Duration = Duration::from_secs(1);
const RECOVERY_BATCH_SIZE: usize = 25;

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
    N: NotificationRepository + NotificationDeliveryRepository,
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
        let ingress_loop = async {
            loop {
                tracing::info!("ingress queue tick");
                match self.queue.receive_messages().await {
                    Ok(messages) if messages.is_empty() => {
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                    Ok(messages) => {
                        let count = messages.len();
                        for message in messages {
                            match tokio::time::timeout(
                                INGRESS_PROCESSING_TIMEOUT,
                                self.service.process_from_queue(message.body.request),
                            )
                            .await
                            {
                                Ok(Ok(_)) => {
                                    if let Err(error) =
                                        self.queue.delete_message(&message.receipt_handle).await
                                    {
                                        tracing::error!(error = ?error, "failed to delete ingress message");
                                    }
                                }
                                Err(timeout) => {
                                    tracing::warn!("Exceeded processing timeout {timeout}");
                                }
                                Ok(Err(error)) => {
                                    tracing::error!(error = ?error, "failed to process ingress notification");
                                }
                            }
                        }
                        tracing::debug!(count, "processed ingress messages");
                    }
                    Err(error) => {
                        tracing::error!(error = ?error, "failed to receive ingress messages");
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                }
            }
        };

        let recovery_loop = async {
            let mut interval = tokio::time::interval(RECOVERY_INTERVAL);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                interval.tick().await;
                match tokio::time::timeout(
                    RECOVERY_BATCH_TIMEOUT,
                    self.service.recover_pending_deliveries(RECOVERY_BATCH_SIZE),
                )
                .await
                {
                    Ok(Ok(())) => {}
                    Ok(Err(error)) => {
                        tracing::warn!(error = ?error, "failed to recover pending notification deliveries");
                    }
                    Err(_) => {
                        tracing::warn!("notification delivery recovery batch timed out");
                    }
                }
            }
        };

        tokio::join!(ingress_loop, recovery_loop);
        unreachable!("notification ingress loops do not exit")
    }
}
