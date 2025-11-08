use anyhow::Context;
use models_email::email::db;
use models_email::email::db::backfill::BackfillMessageStatus;
use models_email::email::service::backfill;
use sqlx::types::Uuid;

/// Creates a backfill message record in the database or increments retry count if it exists
#[tracing::instrument(skip(executor))]
pub async fn upsert_backfill_message<'e, E>(
    executor: E,
    backfill_job_id: Uuid,
    thread_provider_id: &str,
    message_provider_id: &str,
) -> anyhow::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query!(
        r#"
        INSERT INTO email_backfill_messages (backfill_job_id, thread_provider_id, message_provider_id, status)
        VALUES ($1, $2, $3, 'InProgress')
        ON CONFLICT (backfill_job_id, thread_provider_id, message_provider_id)
        DO UPDATE SET 
            updated_at = NOW(),
            retry_count = email_backfill_messages.retry_count + 1
        "#,
        backfill_job_id,
        thread_provider_id,
        message_provider_id
    )
        .execute(executor)
        .await
        .with_context(|| {
            format!(
                "Failed to create backfill message record for backfill_job_id {}, thread_provider_id {} and message_provider_id {}",
                backfill_job_id, thread_provider_id, message_provider_id
            )
        })?;

    Ok(())
}

#[tracing::instrument(skip(executor))]
pub async fn update_backfill_message_status<'e, E>(
    executor: E,
    backfill_job_id: Uuid,
    thread_provider_id: &str,
    message_provider_id: &str,
    status: backfill::BackfillMessageStatus,
    error_message: Option<String>,
) -> anyhow::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let db_status: BackfillMessageStatus = status.into();

    // If error_message is None, we'll keep the existing error_message in the database
    if error_message.is_none() {
        sqlx::query!(
            r#"
            UPDATE email_backfill_messages
            SET status = $4, updated_at = NOW()
            WHERE backfill_job_id = $1 AND thread_provider_id = $2 AND message_provider_id = $3
            "#,
            backfill_job_id,
            thread_provider_id,
            message_provider_id,
            db_status as db::backfill::BackfillMessageStatus,
        )
            .execute(executor)
            .await
            .with_context(|| {
                format!(
                    "Failed to update status for backfill message with backfill_job_id {}, thread_provider_id {} and message_provider_id {}",
                    backfill_job_id, thread_provider_id, message_provider_id
                )
            })?;
    } else {
        // If error_message is Some, update both status and error_message
        sqlx::query!(
            r#"
            UPDATE email_backfill_messages
            SET status = $4, error_message = $5, updated_at = NOW()
            WHERE backfill_job_id = $1 AND thread_provider_id = $2 AND message_provider_id = $3
            "#,
            backfill_job_id,
            thread_provider_id,
            message_provider_id,
            db_status as db::backfill::BackfillMessageStatus,
            error_message
        )
            .execute(executor)
            .await
            .with_context(|| {
                format!(
                    "Failed to update status for backfill message with backfill_job_id {}, thread_provider_id {} and message_provider_id {}",
                    backfill_job_id, thread_provider_id, message_provider_id
                )
            })?;
    }

    Ok(())
}
