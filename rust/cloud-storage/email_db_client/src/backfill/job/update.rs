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
