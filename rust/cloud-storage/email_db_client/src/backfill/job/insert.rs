use anyhow::Context;
use models_email::email::db;
use models_email::email::service;
use sqlx::PgPool;
use sqlx::types::Uuid;

#[tracing::instrument(skip(pool), level = "info")]
pub async fn create_backfill_job(
    pool: &PgPool,
    link_id: Uuid,
    fusionauth_user_id: &str,
    num_threads: Option<i32>,
) -> anyhow::Result<service::backfill::BackfillJob> {
    let id = macro_uuid::generate_uuid_v7();

    let record = sqlx::query_as!(
        db::backfill::BackfillJob,
        r#"
        INSERT INTO email_backfill_jobs (id, link_id, fusionauth_user_id, threads_requested_limit, status)
        VALUES ($1, $2, $3, $4, 'Init')
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
    .fetch_one(pool)
    .await
    .with_context(|| {
        format!(
            "Failed to create backfill job for link_id {} with num_threads {:?}",
            link_id, num_threads
        )
    })?;

    Ok(record.into())
}
