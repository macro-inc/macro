use anyhow::Context;
use models_email::{db, service};

/// Upserts a scheduled message entry
#[tracing::instrument(skip(tx, scheduled_message))]
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
    .await
    .with_context(|| {
        format!(
            "Failed to upsert scheduled message with link_id {} and message_id {}",
            db_message.link_id, db_message.message_id
        )
    })?;

    Ok(())
}

/// Marks a scheduled message as sent
#[tracing::instrument(skip(executor))]
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
    .await
    .with_context(|| {
        format!(
            "Failed to mark scheduled message as sent with link_id {} and message_id {}",
            link_id, message_id
        )
    })?;

    // Return whether a row was actually updated
    Ok(result.rows_affected() > 0)
}

/// Deletes a scheduled message if it exists
#[tracing::instrument(skip(tx))]
pub async fn delete_scheduled_message(
    tx: &mut sqlx::PgConnection,
    link_id: sqlx::types::Uuid,
    message_id: sqlx::types::Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        DELETE FROM email_scheduled_messages
        WHERE link_id = $1 AND message_id = $2
        "#,
        link_id,
        message_id,
    )
    .execute(&mut *tx)
    .await
    .with_context(|| {
        format!(
            "Failed to delete scheduled message with link_id {} and message_id {}",
            link_id, message_id
        )
    })?;

    Ok(())
}

/// Retrieves a scheduled message by link_id and message_id
/// Returns None if the message doesn't exist
#[tracing::instrument(skip(db))]
pub async fn get_scheduled_message(
    db: &sqlx::PgPool,
    link_id: sqlx::types::Uuid,
    message_id: sqlx::types::Uuid,
) -> anyhow::Result<Option<service::message::ScheduledMessage>> {
    let record = sqlx::query!(
        r#"
        SELECT link_id, message_id, send_time, sent
        FROM email_scheduled_messages
        WHERE link_id = $1 AND message_id = $2
        "#,
        link_id,
        message_id,
    )
    .fetch_optional(db)
    .await
    .with_context(|| {
        format!(
            "Failed to retrieve scheduled message with link_id {} and message_id {}",
            link_id, message_id
        )
    })?;

    // Convert the database record to a ScheduledMessage struct if found
    Ok(record.map(|r| service::message::ScheduledMessage {
        link_id: r.link_id,
        message_id: r.message_id,
        send_time: r.send_time,
        sent: r.sent,
    }))
}

/// Retrieves scheduled messages for drafts that have not been sent yet. used for populating
/// messages in get thread by id endpoint
#[tracing::instrument(skip(db))]
pub async fn get_scheduled_message_no_auth(
    db: &sqlx::PgPool,
    message_id: sqlx::types::Uuid,
) -> anyhow::Result<Option<db::message::ScheduledMessage>> {
    let record = sqlx::query!(
        r#"
        SELECT link_id, message_id, send_time, sent
        FROM email_scheduled_messages
        WHERE message_id = $1 and sent = false
        "#,
        message_id,
    )
    .fetch_optional(db)
    .await
    .with_context(|| {
        format!(
            "Failed to retrieve scheduled message with message_id {}",
            message_id
        )
    })?;

    // Convert the database record to a ScheduledMessage struct if found
    Ok(record.map(|r| db::message::ScheduledMessage {
        link_id: r.link_id,
        message_id: r.message_id,
        send_time: r.send_time,
        sent: r.sent,
    }))
}
