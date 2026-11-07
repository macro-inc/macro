use models_email::email::service::crm_cleanup::{CrmCleanupJob, CrmCleanupJobStatus};
use sqlx::PgPool;
use sqlx::types::Uuid;

/// Creates an `Init` cleanup job. Returns `None` when an active
/// (`Init`/`InProgress`) job already exists — the `uq_active_crm_cleanup_job`
/// partial unique index makes this atomic, so duplicate kickoffs no-op.
#[tracing::instrument(skip(pool), err)]
pub async fn create_job(
    pool: &PgPool,
    total_candidates: i64,
    max_candidate_id: i64,
) -> anyhow::Result<Option<CrmCleanupJob>> {
    let id = macro_uuid::generate_uuid_v7();

    let record = sqlx::query_as!(
        CrmCleanupJob,
        r#"
        INSERT INTO crm_cleanup_jobs (id, total_candidates, max_candidate_id, status)
        VALUES ($1, $2, $3, 'Init')
        ON CONFLICT ((TRUE)) WHERE status IN ('Init', 'InProgress') DO NOTHING
        RETURNING
            id,
            status as "status: CrmCleanupJobStatus",
            total_candidates,
            dispatched_count,
            max_candidate_id,
            created_at,
            updated_at
        "#,
        id,
        total_candidates,
        max_candidate_id
    )
    .fetch_optional(pool)
    .await?;

    Ok(record)
}

/// Fetches the active (`Init`/`InProgress`) cleanup job, if any. At most one
/// exists thanks to the `uq_active_crm_cleanup_job` partial unique index.
#[tracing::instrument(skip(pool), err)]
pub async fn get_active_job(pool: &PgPool) -> anyhow::Result<Option<CrmCleanupJob>> {
    let record = sqlx::query_as!(
        CrmCleanupJob,
        r#"
        SELECT
            id,
            status as "status: CrmCleanupJobStatus",
            total_candidates,
            dispatched_count,
            max_candidate_id,
            created_at,
            updated_at
        FROM crm_cleanup_jobs
        WHERE status IN ('Init', 'InProgress')
        "#
    )
    .fetch_optional(pool)
    .await?;

    Ok(record)
}

#[tracing::instrument(skip(pool), err)]
pub async fn get_job(pool: &PgPool, job_id: Uuid) -> anyhow::Result<Option<CrmCleanupJob>> {
    let record = sqlx::query_as!(
        CrmCleanupJob,
        r#"
        SELECT
            id,
            status as "status: CrmCleanupJobStatus",
            total_candidates,
            dispatched_count,
            max_candidate_id,
            created_at,
            updated_at
        FROM crm_cleanup_jobs
        WHERE id = $1
        "#,
        job_id
    )
    .fetch_optional(pool)
    .await?;

    Ok(record)
}

#[tracing::instrument(skip(pool), err)]
pub async fn add_dispatched_count(pool: &PgPool, job_id: Uuid, count: i64) -> anyhow::Result<()> {
    let result = sqlx::query!(
        r#"
        UPDATE crm_cleanup_jobs
        SET dispatched_count = dispatched_count + $1, updated_at = now()
        WHERE id = $2
        "#,
        count,
        job_id
    )
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        anyhow::bail!("No crm cleanup job found with ID: {}", job_id);
    }

    Ok(())
}

#[tracing::instrument(skip(pool), err)]
pub async fn set_job_status(
    pool: &PgPool,
    job_id: Uuid,
    status: CrmCleanupJobStatus,
) -> anyhow::Result<()> {
    let result = sqlx::query!(
        r#"
        UPDATE crm_cleanup_jobs
        SET status = $1::crm_cleanup_job_status, updated_at = now()
        WHERE id = $2
        "#,
        status as _,
        job_id
    )
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        anyhow::bail!("No crm cleanup job found with ID: {}", job_id);
    }

    Ok(())
}

#[cfg(test)]
mod test;
