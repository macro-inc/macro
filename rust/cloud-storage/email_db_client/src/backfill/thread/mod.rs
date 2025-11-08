use anyhow::Context;
use models_email::email::{db, service};
use sqlx::PgPool;
use sqlx::types::Uuid;

/// Creates a backfill thread record in the database or increments retry count if it exists
#[tracing::instrument(skip(executor))]
pub async fn upsert_backfill_thread<'e, E>(
    executor: E,
    backfill_job_id: Uuid,
    thread_provider_id: &str,
) -> anyhow::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query!(
        r#"
        INSERT INTO email_backfill_threads (backfill_job_id, thread_provider_id, status)
        VALUES ($1, $2, 'InProgress')
        ON CONFLICT (backfill_job_id, thread_provider_id)
        DO UPDATE SET 
            updated_at = NOW(),
            retry_count = email_backfill_threads.retry_count + 1
        "#,
        backfill_job_id,
        thread_provider_id
    )
        .execute(executor)
        .await
        .with_context(|| {
            format!(
                "Failed to create or update backfill thread record for backfill_job_id {} and thread_provider_id {}",
                backfill_job_id, thread_provider_id
            )
        })?;

    Ok(())
}

/// Updates the status of a backfill thread record in the database
#[tracing::instrument(skip(executor))]
pub async fn update_backfill_thread_status<'e, E>(
    executor: E,
    backfill_job_id: Uuid,
    thread_provider_id: &str,
    status: service::backfill::BackfillThreadStatus,
    error_message: Option<String>,
) -> anyhow::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let db_status: db::backfill::BackfillThreadStatus = status.into();

    sqlx::query!(
        r#"
        UPDATE email_backfill_threads
        SET status = $3, error_message = $4, updated_at = NOW()
        WHERE backfill_job_id = $1 AND thread_provider_id = $2
        AND status != $3
        "#,
        backfill_job_id,
        thread_provider_id,
        db_status as db::backfill::BackfillThreadStatus,
        error_message
    )
        .execute(executor)
        .await
        .with_context(|| {
            format!(
                "Failed to update status for backfill thread with backfill_job_id {} and thread_provider_id {}",
                backfill_job_id, thread_provider_id
            )
        })?;

    Ok(())
}

pub async fn update_backfill_thread_success<'e, E>(
    executor: E,
    backfill_job_id: Uuid,
    thread_provider_id: &str,
) -> anyhow::Result<service::backfill::BackfillThreadCounters>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let db_status = db::backfill::BackfillThreadStatus::Completed;

    let counters = sqlx::query_as!(
        db::backfill::BackfillThreadCounters,
        r#"
        UPDATE email_backfill_threads
        SET status = $3, metadata_updated = true, updated_at = NOW()
        WHERE backfill_job_id = $1 AND thread_provider_id = $2
        RETURNING messages_retrieved_count, messages_processed_count, messages_succeeded_count, messages_failed_count
        "#,
        backfill_job_id,
        thread_provider_id,
        db_status as db::backfill::BackfillThreadStatus,
    )
        .fetch_one(executor)
        .await
        .with_context(|| {
            format!(
                "Failed to update status for backfill thread with backfill_job_id {} and thread_provider_id {}",
                backfill_job_id, thread_provider_id
            )
        })?;

    Ok(counters.into())
}

/// Updates the number of messages discovered for a backfill thread
#[tracing::instrument(skip(executor))]
pub async fn update_backfill_thread_messages_discovered<'e, E>(
    executor: E,
    backfill_job_id: Uuid,
    thread_provider_id: &str,
    messages_retrieved_count: i32,
) -> anyhow::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let result = sqlx::query!(
        r#"
        UPDATE email_backfill_threads
        SET messages_retrieved_count = $3, updated_at = NOW()
        WHERE backfill_job_id = $1 AND thread_provider_id = $2
        "#,
        backfill_job_id,
        thread_provider_id,
        messages_retrieved_count
    )
        .execute(executor)
        .await
        .with_context(|| {
            format!(
                "Failed to update messages_retrieved_count for backfill thread with backfill_job_id {} and thread_provider_id {}",
                backfill_job_id, thread_provider_id
            )
        })?;

    if result.rows_affected() == 0 {
        return Err(anyhow::anyhow!(
            "No backfill thread found with backfill_job_id: {} and thread_provider_id: {}",
            backfill_job_id,
            thread_provider_id
        ));
    }

    Ok(())
}

#[tracing::instrument(skip(pool), level = "info")]
pub async fn record_message_success_in_thread(
    pool: &PgPool,
    job_id: Uuid,
    thread_provider_id: &str,
) -> anyhow::Result<service::backfill::BackfillThreadCounters> {
    // using RETURNING avoids a second network round trip
    let counters = sqlx::query_as!(
        db::backfill::BackfillThreadCounters,
        r#"
        UPDATE email_backfill_threads
        SET
            messages_processed_count = messages_processed_count + 1,
            messages_succeeded_count = messages_succeeded_count + 1,
            updated_at = now()
        WHERE backfill_job_id = $1
        AND thread_provider_id = $2
        RETURNING
            messages_retrieved_count,
            messages_processed_count,
            messages_succeeded_count,
            messages_failed_count
        "#,
        job_id,
        thread_provider_id
    )
    .fetch_one(pool)
    .await
    .with_context(|| {
        format!(
            "Failed to record message success for backfill job {} thread {}",
            job_id, thread_provider_id
        )
    })?;

    Ok(counters.into())
}

#[tracing::instrument(skip(pool), level = "info")]
pub async fn record_message_failure_in_thread(
    pool: &PgPool,
    job_id: Uuid,
    thread_provider_id: &str,
) -> anyhow::Result<service::backfill::BackfillThreadCounters> {
    // using RETURNING avoids a second networkround trip
    let counters = sqlx::query_as!(
        db::backfill::BackfillThreadCounters,
        r#"
        UPDATE email_backfill_threads
        SET
            messages_processed_count = messages_processed_count + 1,
            messages_failed_count = messages_failed_count + 1,
            updated_at = now()
        WHERE backfill_job_id = $1
        AND thread_provider_id = $2
        RETURNING
            messages_retrieved_count,
            messages_processed_count,
            messages_succeeded_count,
            messages_failed_count
        "#,
        job_id,
        thread_provider_id
    )
    .fetch_one(pool)
    .await
    .with_context(|| {
        format!(
            "Failed to record message failure for backfill job {} thread {}",
            job_id, thread_provider_id
        )
    })?;

    Ok(counters.into())
}
