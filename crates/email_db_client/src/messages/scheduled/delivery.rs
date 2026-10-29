//! Fenced persistence for recoverable scheduled delivery.

use models_email::service::message::ScheduledMessage;
use sqlx::types::Uuid;
use sqlx::{PgConnection, PgPool};

/// A unique ownership receipt; replacing it fences every older invocation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DeliveryClaimToken(pub Uuid);

/// Facts acquired atomically before any provider I/O.
pub struct DeliveryClaim {
    /// Scheduled message identity and attribution.
    pub schedule: ScheduledMessage,
    /// Ownership required by every subsequent transition.
    pub token: DeliveryClaimToken,
    /// Stable RFC 5322 Message-ID; absent for uncertain pre-upgrade submissions.
    pub message_id_header: Option<String>,
    /// Whether a provider submission may already have happened.
    pub requires_reconciliation: bool,
    /// Immutable approved content, when admitted through GraphQL.
    /// Attachment identities retained for every scheduled send.
    pub approved_attachments: serde_json::Value,
    pub approved_snapshot: Option<serde_json::Value>,
    /// Prepared envelope/body frozen by GraphQL admission; absent for older writes.
    pub prepared_content: Option<serde_json::Value>,
}

/// Acquire a fresh or expired claim under the common message -> schedule lock order.
#[tracing::instrument(skip(pool), err)]
pub async fn claim_delivery(
    pool: &PgPool,
    link_id: Uuid,
    message_id: Uuid,
    lease_seconds: i32,
) -> anyhow::Result<Option<DeliveryClaim>> {
    let mut tx = pool.begin().await?;
    let message = sqlx::query!(
        "SELECT is_sent FROM email_messages WHERE id = $1 AND link_id = $2 FOR UPDATE",
        message_id,
        link_id,
    )
    .fetch_optional(&mut *tx)
    .await?;
    if message.is_none_or(|message| message.is_sent) {
        return Ok(None);
    }
    let schedule = sqlx::query!(
        r#"SELECT send_time, sent, processing, actor_id, delivery_claim_id,
                  delivery_started_at, delivery_message_id, delivery_status, approved_attachments,
                  (send_time <= NOW() AND NOT sent AND delivery_status <> 'failed'
                   AND (CASE WHEN processing THEN
                        COALESCE(delivery_lease_expires_at, updated_at + make_interval(secs => $3)) <= NOW()
                        ELSE delivery_lease_expires_at IS NULL OR delivery_lease_expires_at <= NOW() END)) AS "available!"
           FROM email_scheduled_messages WHERE message_id = $1 AND link_id = $2 FOR UPDATE"#,
        message_id, link_id, f64::from(lease_seconds),
    ).fetch_optional(&mut *tx).await?;
    let Some(schedule) = schedule.filter(|row| row.available) else {
        return Ok(None);
    };
    // Old claims have no submission boundary. Never infer they are safe to resend.
    let legacy_claim = schedule.processing && schedule.delivery_claim_id.is_none();
    let reconcile = legacy_claim
        || schedule.delivery_started_at.is_some()
        || schedule.delivery_status == "unconfirmed";
    let header = schedule.delivery_message_id.or_else(|| {
        (!reconcile).then(|| {
            format!(
                "{}.{}@send.macro.com",
                message_id,
                macro_uuid::generate_uuid_v7()
            )
        })
    });
    let token = DeliveryClaimToken(macro_uuid::generate_uuid_v7());
    sqlx::query!(
        r#"UPDATE email_scheduled_messages SET processing = true, delivery_claim_id = $3,
           delivery_lease_expires_at = NOW() + make_interval(secs => $4),
           delivery_message_id = $5,
           delivery_started_at = CASE WHEN $6 THEN COALESCE(delivery_started_at, updated_at) ELSE delivery_started_at END,
           updated_at = NOW() WHERE message_id = $1 AND link_id = $2"#,
        message_id, link_id, token.0, f64::from(lease_seconds), header, legacy_claim,
    ).execute(&mut *tx).await?;
    let attempt = sqlx::query!(
        "SELECT request, prepared_content FROM email_send_attempts WHERE message_id = $1 AND link_id = $2 AND NOT cancelled AND NOT sent ORDER BY send_time DESC NULLS LAST LIMIT 1",
        message_id, link_id,
    ).fetch_optional(&mut *tx).await?;
    tx.commit().await?;
    Ok(Some(DeliveryClaim {
        schedule: ScheduledMessage {
            link_id,
            message_id,
            send_time: schedule.send_time,
            sent: false,
            processing: true,
            actor_id: schedule.actor_id,
        },
        token,
        message_id_header: header,
        requires_reconciliation: reconcile,
        approved_attachments: schedule.approved_attachments,
        approved_snapshot: attempt.as_ref().and_then(|attempt| attempt.request.clone()),
        prepared_content: attempt.and_then(|attempt| attempt.prepared_content),
    }))
}

/// Persist the point after which loss of this invocation requires reconciliation.
#[tracing::instrument(skip(pool, claim), err)]
pub async fn begin_submission(
    pool: &PgPool,
    claim: &DeliveryClaim,
    lease_seconds: i32,
) -> anyhow::Result<bool> {
    let changed = sqlx::query!(
        r#"UPDATE email_scheduled_messages SET delivery_started_at = NOW(),
           delivery_lease_expires_at = NOW() + make_interval(secs => $4), updated_at = NOW()
           WHERE message_id = $1 AND link_id = $2 AND delivery_claim_id = $3
             AND processing AND NOT sent AND delivery_status = 'ready'
             AND delivery_started_at IS NULL AND delivery_lease_expires_at > NOW()"#,
        claim.schedule.message_id,
        claim.schedule.link_id,
        claim.token.0,
        f64::from(lease_seconds),
    )
    .execute(pool)
    .await?;
    Ok(changed.rows_affected() == 1)
}

/// Back off preparation without exposing managed claims to pre-upgrade workers.
#[tracing::instrument(skip(pool, claim), err)]
pub async fn release_preparation(
    pool: &PgPool,
    claim: &DeliveryClaim,
    retry_seconds: i32,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"UPDATE email_scheduled_messages SET processing = true,
           delivery_lease_expires_at = NOW() + make_interval(secs => $4), updated_at = NOW()
           WHERE message_id = $1 AND link_id = $2 AND delivery_claim_id = $3
             AND processing AND NOT sent AND delivery_started_at IS NULL AND delivery_status = 'ready'"#,
        claim.schedule.message_id, claim.schedule.link_id, claim.token.0, f64::from(retry_seconds),
    ).execute(pool).await?;
    Ok(())
}

/// Persist a paused delivery; unconfirmed outcomes remain eligible only for lookup.
#[tracing::instrument(skip(pool, claim), err)]
pub async fn pause_delivery(
    pool: &PgPool,
    claim: &DeliveryClaim,
    unconfirmed: bool,
    retry_seconds: i32,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"UPDATE email_scheduled_messages SET processing = true,
           delivery_status = CASE WHEN $4 THEN 'unconfirmed' ELSE 'failed' END,
           delivery_lease_expires_at = NOW() + make_interval(secs => $5), updated_at = NOW()
           WHERE message_id = $1 AND link_id = $2 AND delivery_claim_id = $3 AND NOT sent"#,
        claim.schedule.message_id,
        claim.schedule.link_id,
        claim.token.0,
        unconfirmed,
        f64::from(retry_seconds),
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Fence completion after taking the message lock, before changing message state.
#[tracing::instrument(skip(tx, claim), err)]
pub async fn complete_delivery(
    tx: &mut PgConnection,
    claim: &DeliveryClaim,
) -> anyhow::Result<bool> {
    let row = sqlx::query!(
        "SELECT is_sent FROM email_messages WHERE id = $1 AND link_id = $2 FOR UPDATE",
        claim.schedule.message_id,
        claim.schedule.link_id,
    )
    .fetch_optional(&mut *tx)
    .await?;
    if row.is_none_or(|row| row.is_sent) {
        return Ok(false);
    }
    let changed = sqlx::query!(
        r#"UPDATE email_scheduled_messages SET sent = true, processing = false,
           delivery_status = 'ready', delivery_lease_expires_at = NULL, updated_at = NOW()
           WHERE message_id = $1 AND link_id = $2 AND delivery_claim_id = $3
             AND processing AND NOT sent AND delivery_started_at IS NOT NULL"#,
        claim.schedule.message_id,
        claim.schedule.link_id,
        claim.token.0,
    )
    .execute(&mut *tx)
    .await?;
    Ok(changed.rows_affected() == 1)
}

#[cfg(test)]
mod test;
