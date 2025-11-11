use anyhow::Context;
use models_email::email::db;
use models_email::email::service;
use sqlx::PgPool;
use sqlx::types::Uuid;

#[tracing::instrument(skip(pool), level = "info")]
pub async fn get_backfill_job(
    pool: &PgPool,
    job_id: Uuid,
) -> anyhow::Result<Option<service::backfill::BackfillJob>> {
    let record = sqlx::query_as!(
        db::backfill::BackfillJob,
        r#"
        SELECT
            id,
            link_id,
            fusionauth_user_id,
            threads_requested_limit,
            total_threads,
            threads_retrieved_count,
            status as "status: db::backfill::BackfillJobStatus",
            created_at,
            updated_at
        FROM email_backfill_jobs
        WHERE id = $1
        "#,
        job_id
    )
    .fetch_optional(pool)
    .await
    .with_context(|| format!("Failed to query backfill job with ID: {}", job_id))?;

    Ok(record.map(Into::into))
}

#[tracing::instrument(skip(pool), level = "info")]
pub async fn get_backfill_job_with_link_id(
    pool: &PgPool,
    job_id: Uuid,
    link_id: Uuid,
) -> anyhow::Result<Option<service::backfill::BackfillJob>> {
    let record = sqlx::query_as!(
        db::backfill::BackfillJob,
        r#"
        SELECT
            id,
            link_id,
            fusionauth_user_id,
            threads_requested_limit,
            total_threads,
            threads_retrieved_count,
            status as "status: db::backfill::BackfillJobStatus",
            created_at,
            updated_at
        FROM email_backfill_jobs
        WHERE id = $1
        AND link_id = $2
        "#,
        job_id,
        link_id
    )
    .fetch_optional(pool)
    .await
    .with_context(|| format!("Failed to query backfill job with ID: {}", job_id))?;

    Ok(record.map(Into::into))
}

/// Retrieves all backfill jobs created in the last 24 hours for a given macro ID
#[tracing::instrument(skip(pool), level = "info")]
pub async fn get_recent_jobs_by_fusionauth_user_id(
    pool: &PgPool,
    fusionauth_user_id: &str,
) -> anyhow::Result<Vec<service::backfill::BackfillJob>> {
    // Query for all jobs created within the last 24 hours for the specified link
    let records = sqlx::query_as!(
        db::backfill::BackfillJob,
        r#"
        SELECT
            id,
            link_id,
            fusionauth_user_id,
            threads_requested_limit,
            total_threads,
            threads_retrieved_count,
            status as "status: db::backfill::BackfillJobStatus",
            created_at,
            updated_at
        FROM email_backfill_jobs
        WHERE fusionauth_user_id = $1
        AND created_at > NOW() - INTERVAL '24 hours'
        ORDER BY created_at DESC
        "#,
        fusionauth_user_id
    )
    .fetch_all(pool)
    .await
    .with_context(|| {
        format!(
            "Failed to fetch recent backfill jobs for fusionauth_user_id: {}",
            fusionauth_user_id
        )
    })?;

    // Convert all database records to service models
    let jobs = records.into_iter().map(Into::into).collect();

    Ok(jobs)
}
