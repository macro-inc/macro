use models_email::{db, service};

/// Upserts a scheduled message entry
#[tracing::instrument(skip(tx, scheduled_message), err)]
pub async fn upsert_scheduled_message(
    tx: &mut sqlx::PgConnection,
    scheduled_message: service::message::ScheduledMessage,
) -> anyhow::Result<()> {
    let db_message = db::message::ScheduledMessage::from(scheduled_message);
    sqlx::query!(
        r#"
        INSERT INTO email_scheduled_messages (
            link_id, message_id, send_time, sent,
            created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        ON CONFLICT (link_id, message_id) DO UPDATE SET
            send_time = EXCLUDED.send_time,
            sent = EXCLUDED.sent,
            updated_at = NOW()
        "#,
        db_message.link_id,
        db_message.message_id,
        db_message.send_time,
        db_message.sent,
    )
    .execute(&mut *tx)
    .await?;

    Ok(())
}

/// Marks a scheduled message as sent
#[tracing::instrument(skip(executor), err)]
pub async fn mark_scheduled_message_as_sent<'e, E>(
    executor: E,
    link_id: sqlx::types::Uuid,
    message_id: sqlx::types::Uuid,
) -> anyhow::Result<bool>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let result = sqlx::query!(
        r#"
        UPDATE email_scheduled_messages
        SET
            sent = true,
            updated_at = NOW()
        WHERE link_id = $1 AND message_id = $2
        "#,
        link_id,
        message_id,
    )
    .execute(executor)
    .await?;

    // Return whether a row was actually updated
    Ok(result.rows_affected() > 0)
}
