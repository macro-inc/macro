//! Persistence and queue adapters for scheduled delivery recovery.

use email::domain::scheduled_delivery::recovery::{
    PendingDelivery, ScheduledRecoveryQueue, ScheduledRecoveryRepo,
};
use futures::{Stream, TryStreamExt};
use models_email::service::pubsub::ScheduledPubsubMessage;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone)]
pub struct RecoveryRepository(pub PgPool);

impl ScheduledRecoveryRepo for RecoveryRepository {
    fn pending_deliveries(&self) -> impl Stream<Item = anyhow::Result<PendingDelivery>> + Send {
        stream_pending_scheduled_messages(&self.0)
    }
}

#[derive(Clone)]
pub struct RecoveryQueue(pub Arc<sqs_client::SQS>);

impl ScheduledRecoveryQueue for RecoveryQueue {
    async fn enqueue(&self, delivery: PendingDelivery) -> anyhow::Result<()> {
        self.0
            .enqueue_email_scheduled_message(
                ScheduledPubsubMessage {
                    link_id: delivery.link_id,
                    message_id: delivery.message_id,
                },
                None,
            )
            .await?;
        Ok(())
    }
}

/// Streams eligible unsent work without accumulating the mailbox backlog in memory.
/// SQLx bounds row buffering while the domain publishes each durable notification.
fn stream_pending_scheduled_messages(
    pool: &PgPool,
) -> impl Stream<Item = anyhow::Result<PendingDelivery>> + Send + '_ {
    sqlx::query_as!(
        PendingDelivery,
        r#"
        SELECT
            esm.link_id, esm.message_id
        FROM email_scheduled_messages esm
        JOIN email_messages em ON em.id = esm.message_id
        WHERE
            esm.send_time < now()
            AND esm.sent = FALSE
            AND em.is_sent = FALSE
            AND esm.delivery_status <> 'failed'
            AND (CASE WHEN esm.processing THEN
                COALESCE(esm.delivery_lease_expires_at, esm.updated_at + make_interval(secs => $1)) <= NOW()
                ELSE esm.delivery_lease_expires_at IS NULL OR esm.delivery_lease_expires_at <= NOW() END)
            AND (em.is_draft OR esm.delivery_claim_id IS NOT NULL OR EXISTS (
                SELECT 1 FROM email_send_attempts a
                WHERE a.link_id = esm.link_id AND a.message_id = esm.message_id AND NOT a.cancelled
            ))
        "#,
        f64::from(email::domain::scheduled_delivery::DELIVERY_LEASE_SECONDS),
    )
    .fetch(pool)
    .map_err(anyhow::Error::from)
}

#[cfg(test)]
pub async fn fetch_pending_scheduled_messages(
    pool: &PgPool,
) -> anyhow::Result<Vec<PendingDelivery>> {
    stream_pending_scheduled_messages(pool).try_collect().await
}
