use anyhow::Context;
use models_email::email::db;
use models_email::email::service;
use sqlx::PgPool;
use sqlx::types::Uuid;

#[tracing::instrument(skip(executor), level = "info")]
pub async fn update_backfill_job_status<'e, E>(
    executor: E,
    job_id: Uuid,
    status: service::backfill::BackfillJobStatus,
) -> anyhow::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let db_status: service::backfill::BackfillJobStatus = status;
    let result = sqlx::query!(
        r#"
        UPDATE email_backfill_jobs
        SET status = $1::email_backfill_job_status, updated_at = now()
        WHERE id = $2
        "#,
        db_status as _,
        job_id
    )
    .execute(executor)
    .await
    .with_context(|| format!("Failed to update status for backfill job {}", job_id))?;

    if result.rows_affected() == 0 {
        return Err(anyhow::anyhow!("No backfill job found with ID: {}", job_id));
    }

    Ok(())
}

#[tracing::instrument(skip(pool), level = "info")]
pub async fn cancel_active_jobs_by_link_id(pool: &PgPool, link_id: Uuid) -> anyhow::Result<usize> {
    let db_status = db::backfill::BackfillJobStatus::Cancelled;

    let result = sqlx::query!(
        r#"
        UPDATE email_backfill_jobs
        SET status = $1::email_backfill_job_status, updated_at = now()
        WHERE link_id = $2
        AND status IN ('Init', 'InProgress')
        "#,
        db_status as _,
        link_id
    )
    .execute(pool)
    .await
    .with_context(|| {
        format!(
            "Failed to update status for backfill jobs with link_id: {}",
            link_id
        )
    })?;

    let rows_affected = result.rows_affected() as usize;
    Ok(rows_affected)
}

#[tracing::instrument(skip(pool), level = "info")]
pub async fn update_job_total_threads(
    pool: &PgPool,
    job_id: Uuid,
    num_threads: i32,
) -> anyhow::Result<()> {
    let result = sqlx::query!(
        r#"
        UPDATE email_backfill_jobs
        SET total_threads = $1, updated_at = now()
        WHERE id = $2
        "#,
        num_threads,
        job_id
    )
    .execute(pool)
    .await
    .with_context(|| format!("Failed to update num_threads for backfill job {}", job_id))?;

    if result.rows_affected() == 0 {
        return Err(anyhow::anyhow!("No backfill job found with ID: {}", job_id));
    }

    Ok(())
}

#[tracing::instrument(skip(pool), level = "info")]
pub async fn update_job_threads_retrieved_count(
    pool: &PgPool,
    job_id: Uuid,
    num_threads: i32,
) -> anyhow::Result<()> {
    let result = sqlx::query!(
        r#"
        UPDATE email_backfill_jobs
        SET threads_retrieved_count = threads_retrieved_count + $1, updated_at = now()
        WHERE id = $2
        "#,
        num_threads,
        job_id
    )
    .execute(pool)
    .await
    .with_context(|| {
        format!(
            "Failed to update threads_retrieved_count for backfill job {}",
            job_id
        )
    })?;

    if result.rows_affected() == 0 {
        return Err(anyhow::anyhow!("No backfill job found with ID: {}", job_id));
    }

    Ok(())
}

/// Updates the number of messages discovered for a backfill job
#[tracing::instrument(skip(executor))]
pub async fn update_backfill_job_messages_discovered<'e, E>(
    executor: E,
    backfill_job_id: Uuid,
    messages_retrieved_count: i32,
) -> anyhow::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let result = sqlx::query!(
        r#"
        UPDATE email_backfill_jobs
        SET messages_retrieved_count = messages_retrieved_count + $2,
            updated_at = NOW()
        WHERE id = $1
        "#,
        backfill_job_id,
        messages_retrieved_count
    )
    .execute(executor)
    .await
    .with_context(|| {
        format!(
            "Failed to update messages_retrieved_count for backfill job with backfill_job_id {}",
            backfill_job_id
        )
    })?;

    if result.rows_affected() == 0 {
        return Err(anyhow::anyhow!(
            "No backfill job found with backfill_job_id {}",
            backfill_job_id,
        ));
    }

    Ok(())
}

// increment the relevant counters when a thread is successfully processed
#[tracing::instrument(skip(executor), level = "info")]
pub async fn record_thread_success_in_job<'e, E>(
    executor: E,
    job_id: Uuid,
    counters: service::backfill::BackfillThreadCounters,
) -> anyhow::Result<service::backfill::BackfillJobCounters>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let counters: service::backfill::BackfillThreadCounters = counters;

    let job_counters = sqlx::query_as!(
        db::backfill::BackfillJobCounters,
        r#"
        UPDATE email_backfill_jobs
        SET
            threads_processed_count = threads_processed_count + 1,
            threads_succeeded_count = threads_succeeded_count + 1,
            messages_processed_count = messages_processed_count + $2,
            messages_succeeded_count = messages_succeeded_count + $3,
            messages_failed_count = messages_failed_count + $4,
            updated_at = now()
        WHERE id = $1
        RETURNING total_threads, threads_processed_count
        "#,
        job_id,
        counters.messages_processed_count,
        counters.messages_succeeded_count,
        counters.messages_failed_count
    )
    .fetch_one(executor)
    .await
    .with_context(|| {
        format!(
            "Failed to record thread success for backfill job {}",
            job_id
        )
    })?;

    Ok(job_counters.into())
}

#[tracing::instrument(skip(executor), level = "info")]
pub async fn record_thread_skipped_in_job<'e, E>(
    executor: E,
    job_id: Uuid,
) -> anyhow::Result<service::backfill::BackfillJobCounters>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let job_counters = sqlx::query_as!(
        db::backfill::BackfillJobCounters,
        r#"
        UPDATE email_backfill_jobs
        SET
            threads_processed_count = threads_processed_count + 1,
            threads_skipped_count = threads_skipped_count + 1,
            updated_at = now()
        WHERE id = $1
        RETURNING total_threads, threads_processed_count
        "#,
        job_id
    )
    .fetch_one(executor)
    .await
    .with_context(|| {
        format!(
            "Failed to record thread skipped for backfill job {}",
            job_id
        )
    })?;

    Ok(job_counters.into())
}

#[tracing::instrument(skip(pool), level = "info")]
pub async fn record_thread_failure_in_job(pool: &PgPool, job_id: Uuid) -> anyhow::Result<()> {
    let result = sqlx::query!(
        r#"
        UPDATE email_backfill_jobs
        SET
            threads_processed_count = threads_processed_count + 1,
            threads_failed_count = threads_failed_count + 1,
            updated_at = now()
        WHERE id = $1
        "#,
        job_id
    )
    .execute(pool)
    .await
    .with_context(|| {
        format!(
            "Failed to record thread failure for backfill job {}",
            job_id
        )
    })?;

    if result.rows_affected() == 0 {
        return Err(anyhow::anyhow!(
            "Attempted to record thread failure, but no backfill job was found with ID: {}",
            job_id
        ));
    }

    Ok(())
}
