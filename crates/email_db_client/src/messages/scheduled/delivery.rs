//! Statement-sized storage for durable scheduled delivery.
use sqlx::types::Uuid;
use sqlx::{PgConnection, PgPool};

/// Schedule facts, including availability decided atomically by PostgreSQL.
pub struct ScheduleFacts {
    pub send_time: chrono::DateTime<chrono::Utc>,
    pub processing: bool,
    pub actor_id: Option<String>,
    pub agent_correlation_id: Option<Uuid>,
    pub delivery_claim_id: Option<Uuid>,
    pub delivery_started_at: Option<chrono::DateTime<chrono::Utc>>,
    pub delivery_message_id: Option<String>,
    pub delivery_status: String,
    pub approved_attachments: serde_json::Value,
    pub available: bool,
}
/// Frozen admission content selected by the existing attempt query.
pub struct AttemptFacts {
    pub request: Option<serde_json::Value>,
    pub prepared_content: Option<serde_json::Value>,
}

/// Lock the message before its schedule and return its sent flag.
pub async fn message_sent(
    tx: &mut PgConnection,
    link_id: Uuid,
    message_id: Uuid,
) -> anyhow::Result<Option<bool>> {
    let message = sqlx::query!(
        "SELECT is_sent FROM email_messages WHERE id = $1 AND link_id = $2 FOR UPDATE",
        message_id,
        link_id,
    )
    .fetch_optional(&mut *tx)
    .await?;
    Ok(message.map(|row| row.is_sent))
}

/// Lock the message before the completion fence and return its sent flag.
pub async fn completion_message_sent(
    tx: &mut PgConnection,
    link_id: Uuid,
    message_id: Uuid,
) -> anyhow::Result<Option<bool>> {
    let message = sqlx::query!(
        "SELECT is_sent FROM email_messages WHERE id = $1 AND link_id = $2 FOR UPDATE",
        message_id,
        link_id,
    )
    .fetch_optional(&mut *tx)
    .await?;
    Ok(message.map(|row| row.is_sent))
}

/// Lock and read the schedule, without interpreting availability.
pub async fn schedule_facts(
    tx: &mut PgConnection,
    link_id: Uuid,
    message_id: Uuid,
    lease_seconds: i32,
) -> anyhow::Result<Option<ScheduleFacts>> {
    let row = sqlx::query!(
        r#"SELECT send_time, sent, processing, actor_id, agent_correlation_id, delivery_claim_id,
                  delivery_started_at, delivery_message_id, delivery_status, approved_attachments,
                  (send_time <= NOW() AND NOT sent AND delivery_status <> 'failed'
                   AND (CASE WHEN processing THEN
                        COALESCE(delivery_lease_expires_at, updated_at + make_interval(secs => $3)) <= NOW()
                        ELSE delivery_lease_expires_at IS NULL OR delivery_lease_expires_at <= NOW() END)) AS "available!"
           FROM email_scheduled_messages WHERE message_id = $1 AND link_id = $2 FOR UPDATE"#,
        message_id, link_id, f64::from(lease_seconds),
    ).fetch_optional(&mut *tx).await?;
    Ok(row.map(|row| ScheduleFacts {
        send_time: row.send_time,
        processing: row.processing,
        actor_id: row.actor_id,
        agent_correlation_id: row.agent_correlation_id,
        delivery_claim_id: row.delivery_claim_id,
        delivery_started_at: row.delivery_started_at,
        delivery_message_id: row.delivery_message_id,
        delivery_status: row.delivery_status,
        approved_attachments: row.approved_attachments,
        available: row.available,
    }))
}

/// Store the caller-selected ownership token and header.
pub async fn acquire_claim(
    tx: &mut PgConnection,
    link_id: Uuid,
    message_id: Uuid,
    token: Uuid,
    lease_seconds: i32,
    header: Option<&str>,
    legacy_claim: bool,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"UPDATE email_scheduled_messages SET processing = true, delivery_claim_id = $3,
           delivery_lease_expires_at = NOW() + make_interval(secs => $4),
           delivery_message_id = $5,
           delivery_started_at = CASE WHEN $6 THEN COALESCE(delivery_started_at, updated_at) ELSE delivery_started_at END,
           updated_at = NOW() WHERE message_id = $1 AND link_id = $2"#,
        message_id, link_id, token, f64::from(lease_seconds), header, legacy_claim,
    ).execute(&mut *tx).await?;
    Ok(())
}

/// Read the current attempt without changing its relational selection.
pub async fn attempt_facts(
    tx: &mut PgConnection,
    link_id: Uuid,
    message_id: Uuid,
) -> anyhow::Result<Option<AttemptFacts>> {
    let row = sqlx::query!(
        "SELECT request, prepared_content FROM email_send_attempts WHERE message_id = $1 AND link_id = $2 AND NOT cancelled AND NOT sent ORDER BY send_time DESC NULLS LAST LIMIT 1",
        message_id, link_id,
    ).fetch_optional(&mut *tx).await?;
    Ok(row.map(|row| AttemptFacts {
        request: row.request,
        prepared_content: row.prepared_content,
    }))
}

/// Execute the fenced begin_submission statement.
pub async fn begin_submission(
    pool: &PgPool,
    message_id: Uuid,
    link_id: Uuid,
    token: Uuid,
    lease_seconds: i32,
) -> anyhow::Result<u64> {
    let changed = sqlx::query!(
        r#"UPDATE email_scheduled_messages SET delivery_started_at = NOW(),
           delivery_lease_expires_at = NOW() + make_interval(secs => $4), updated_at = NOW()
           WHERE message_id = $1 AND link_id = $2 AND delivery_claim_id = $3
             AND processing AND NOT sent AND delivery_status = 'ready'
             AND delivery_started_at IS NULL AND delivery_lease_expires_at > NOW()"#,
        message_id,
        link_id,
        token,
        f64::from(lease_seconds),
    )
    .execute(pool)
    .await?;
    Ok(changed.rows_affected())
}

/// Execute the fenced release_preparation statement.
pub async fn release_preparation(
    pool: &PgPool,
    message_id: Uuid,
    link_id: Uuid,
    token: Uuid,
    retry_seconds: i32,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"UPDATE email_scheduled_messages SET processing = true,
           delivery_lease_expires_at = NOW() + make_interval(secs => $4), updated_at = NOW()
           WHERE message_id = $1 AND link_id = $2 AND delivery_claim_id = $3
             AND processing AND NOT sent AND delivery_started_at IS NULL AND delivery_status = 'ready'"#,
        message_id, link_id, token, f64::from(retry_seconds),
    ).execute(pool).await?;
    Ok(())
}

/// Execute the fenced pause_delivery statement.
pub async fn pause_delivery(
    pool: &PgPool,
    message_id: Uuid,
    link_id: Uuid,
    token: Uuid,
    unconfirmed: bool,
    retry_seconds: i32,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"UPDATE email_scheduled_messages SET processing = true,
           delivery_status = CASE WHEN $4 THEN 'unconfirmed' ELSE 'failed' END,
           delivery_lease_expires_at = NOW() + make_interval(secs => $5), updated_at = NOW()
           WHERE message_id = $1 AND link_id = $2 AND delivery_claim_id = $3 AND NOT sent"#,
        message_id,
        link_id,
        token,
        unconfirmed,
        f64::from(retry_seconds),
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Execute the ownership-fenced completion statement.
pub async fn complete_delivery(
    tx: &mut PgConnection,
    message_id: Uuid,
    link_id: Uuid,
    token: Uuid,
) -> anyhow::Result<u64> {
    let changed = sqlx::query!(
        r#"UPDATE email_scheduled_messages SET sent = true, processing = false,
           delivery_status = 'ready', delivery_lease_expires_at = NULL, updated_at = NOW()
           WHERE message_id = $1 AND link_id = $2 AND delivery_claim_id = $3
             AND processing AND NOT sent AND delivery_started_at IS NOT NULL"#,
        message_id,
        link_id,
        token,
    )
    .execute(&mut *tx)
    .await?;
    Ok(changed.rows_affected())
}
