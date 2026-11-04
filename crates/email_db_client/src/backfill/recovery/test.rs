use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_recovery_creates_one_replacement_and_preserves_old_evidence(pool: PgPool) {
    let link = Uuid::now_v7();
    let job = Uuid::now_v7();
    sqlx::query!("INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider) VALUES ($1, 'macro|recovery@example.test', 'fa-recovery', 'recovery@example.test', 'GMAIL')", link).execute(&pool).await.unwrap();
    sqlx::query!("INSERT INTO email_backfill_jobs (id, link_id, fusionauth_user_id, status, total_threads, threads_retrieved_count) VALUES ($1, $2, 'fa-recovery', 'InProgress', 2000, 1500)", job, link).execute(&pool).await.unwrap();
    let (a, b) = tokio::join!(
        restart_legacy_job(&pool, job),
        restart_legacy_job(&pool, job)
    );
    let a = a.unwrap();
    assert_eq!(a, b.unwrap());
    assert_ne!(a.job_id, job);
    assert_eq!(a.link_id, link);
    let old = sqlx::query!("SELECT status::text AS status, total_threads, threads_retrieved_count FROM email_backfill_jobs WHERE id = $1", job).fetch_one(&pool).await.unwrap();
    assert_eq!(old.status.as_deref(), Some("Cancelled"));
    assert_eq!(
        (old.total_threads, old.threads_retrieved_count),
        (2000, 1500)
    );
    let new = sqlx::query!("SELECT status::text AS status, is_recovery, threads_requested_limit, completed_threads FROM email_backfill_jobs WHERE id = $1", a.job_id).fetch_one(&pool).await.unwrap();
    assert_eq!(new.status.as_deref(), Some("Init"));
    assert!(new.is_recovery);
    assert_eq!(new.threads_requested_limit, None);
    assert_eq!(new.completed_threads, None);
    // An interrupted send can recover exactly the same Init payload later.
    assert_eq!(restart_legacy_job(&pool, job).await.unwrap(), a);
    crate::links::delete::mark_link_deleting(&pool, link)
        .await
        .unwrap();
    assert!(restart_legacy_job(&pool, job).await.is_err());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_link_being_purged_cannot_start_recovery(pool: PgPool) {
    let link = Uuid::now_v7();
    let job = Uuid::now_v7();
    sqlx::query!("INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, deleting_at) VALUES ($1, 'macro|recovery@example.test', 'fa-recovery', 'recovery@example.test', 'GMAIL', now())", link).execute(&pool).await.unwrap();
    sqlx::query!("INSERT INTO email_backfill_jobs (id, link_id, fusionauth_user_id, status) VALUES ($1, $2, 'fa-recovery', 'InProgress')", job, link).execute(&pool).await.unwrap();
    assert!(restart_legacy_job(&pool, job).await.is_err());
    let status = sqlx::query_scalar!(
        "SELECT status::text FROM email_backfill_jobs WHERE id = $1",
        job
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(status.as_deref(), Some("InProgress"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleted_links_and_durable_or_terminal_jobs_cannot_be_replaced(pool: PgPool) {
    let missing_link = Uuid::now_v7();
    let live_link = Uuid::now_v7();
    let durable = Uuid::now_v7();
    let cancelled = Uuid::now_v7();
    sqlx::query!("INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider) VALUES ($1, 'macro|recovery@example.test', 'fa-recovery', 'recovery@example.test', 'GMAIL')", live_link).execute(&pool).await.unwrap();
    sqlx::query!("INSERT INTO email_backfill_jobs (id, link_id, fusionauth_user_id, status, completed_threads) VALUES ($1, NULL, 'fa-recovery', 'InProgress', NULL), ($2, $4, 'fa-recovery', 'InProgress', 0), ($3, $4, 'fa-recovery', 'Cancelled', NULL)", missing_link, durable, cancelled, live_link).execute(&pool).await.unwrap();
    for job in [missing_link, durable, cancelled] {
        assert!(restart_legacy_job(&pool, job).await.is_err());
    }
    let replacements = sqlx::query_scalar!(
        "SELECT count(*) FROM email_backfill_jobs WHERE recovery_of IS NOT NULL"
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(replacements, Some(0));
}
