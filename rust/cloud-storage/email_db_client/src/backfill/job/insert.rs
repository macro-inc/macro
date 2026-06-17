use models_email::email::db;
use models_email::email::service;
use sqlx::PgPool;
use sqlx::types::Uuid;

/// Creates an `Init` backfill job for a link. Returns `None` when an active
/// (`Init`/`InProgress`) job already exists for the link — the `uq_active_backfill_job_per_link`
/// partial unique index makes this atomic, so concurrent callers don't create duplicates.
#[tracing::instrument(skip(pool), err)]
pub async fn create_backfill_job(
    pool: &PgPool,
    link_id: Uuid,
    fusionauth_user_id: &str,
    num_threads: Option<i32>,
) -> anyhow::Result<Option<service::backfill::BackfillJob>> {
    let id = macro_uuid::generate_uuid_v7();

    let record = sqlx::query_as!(
        db::backfill::BackfillJob,
        r#"
        INSERT INTO email_backfill_jobs (id, link_id, fusionauth_user_id, threads_requested_limit, status)
        VALUES ($1, $2, $3, $4, 'Init')
        ON CONFLICT (link_id) WHERE status IN ('Init', 'InProgress') DO NOTHING
        RETURNING
            id,
            link_id,
            fusionauth_user_id,
            threads_requested_limit,
            total_threads,
            threads_retrieved_count,
            status as "status: db::backfill::BackfillJobStatus",
            created_at,
            updated_at
        "#,
        id,
        link_id,
        fusionauth_user_id,
        num_threads
    )
    .fetch_optional(pool)
    .await?;

    Ok(record.map(Into::into))
}

#[cfg(test)]
mod test;
