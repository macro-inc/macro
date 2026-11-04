use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_work_is_deferred_without_spending_its_receive_budget(pool: PgPool) {
    let job = Uuid::now_v7();
    sqlx::query!("INSERT INTO email_backfill_jobs (id, fusionauth_user_id, status) VALUES ($1, 'fa-progress', 'InProgress')", job).execute(&pool).await.unwrap();
    let Err(ProcessingError::Retryable(detail)) = require_durable(&pool, job).await else {
        panic!("legacy work must wait for recovery");
    };
    assert!(matches!(
        detail.reason,
        FailureReason::BackfillProgressNeedsRecovery
    ));
    sqlx::query!(
        "UPDATE email_backfill_jobs SET completed_threads = 0 WHERE id = $1",
        job
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(require_durable(&pool, job).await.is_ok());
}
