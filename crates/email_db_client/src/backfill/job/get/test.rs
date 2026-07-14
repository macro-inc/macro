use super::{get_all_jobs_by_fusionauth_user_id, get_recent_jobs_by_fusionauth_user_id};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_email::email::db::backfill::BackfillJobStatus as DbStatus;
use models_email::email::service::backfill::BackfillJobStatus;
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres};

async fn insert_job(pool: &Pool<Postgres>, fusion: &str, status: DbStatus, hours_ago: i32) {
    sqlx::query!(
        r#"INSERT INTO email_backfill_jobs (id, fusionauth_user_id, status, created_at)
           VALUES ($1, $2, $3::email_backfill_job_status, NOW() - ($4::int * INTERVAL '1 hour'))"#,
        Uuid::new_v4(),
        fusion,
        status as _,
        hours_ago,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn recent_jobs_excludes_terminal_and_old_and_other_users(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    const FUSION: &str = "fusion-rate-limit-user";
    const OTHER: &str = "fusion-other-user";

    // Recent, non-terminal → counted.
    insert_job(&pool, FUSION, DbStatus::Init, 1).await;
    insert_job(&pool, FUSION, DbStatus::InProgress, 2).await;
    insert_job(&pool, FUSION, DbStatus::Complete, 3).await;
    // Recent but terminal → excluded so connect/disconnect churn does not count.
    insert_job(&pool, FUSION, DbStatus::Cancelled, 1).await;
    insert_job(&pool, FUSION, DbStatus::Failed, 2).await;
    // Older than the 24h window → excluded.
    insert_job(&pool, FUSION, DbStatus::Init, 25).await;
    // Different user → excluded.
    insert_job(&pool, OTHER, DbStatus::Init, 1).await;

    let jobs = get_recent_jobs_by_fusionauth_user_id(&pool, FUSION).await?;

    assert_eq!(jobs.len(), 3);
    assert!(jobs.iter().all(|j| j.fusionauth_user_id == FUSION));
    assert!(jobs.iter().all(|j| !matches!(
        j.status,
        BackfillJobStatus::Cancelled | BackfillJobStatus::Failed
    )));

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn all_jobs_returns_users_jobs_any_status_newest_first(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    const FUSION: &str = "fusion-all-jobs-user";
    const OTHER: &str = "fusion-other-user";

    // Unlike the recent query, every status counts and there's no time window.
    insert_job(&pool, FUSION, DbStatus::Complete, 3).await; // oldest
    insert_job(&pool, FUSION, DbStatus::InProgress, 2).await;
    insert_job(&pool, FUSION, DbStatus::Cancelled, 1).await;
    insert_job(&pool, FUSION, DbStatus::Failed, 0).await; // newest
    insert_job(&pool, FUSION, DbStatus::Init, 100).await; // well outside any 24h window
    // Different user → excluded.
    insert_job(&pool, OTHER, DbStatus::Complete, 1).await;

    let jobs = get_all_jobs_by_fusionauth_user_id(&pool, FUSION).await?;

    assert_eq!(jobs.len(), 5);
    assert!(jobs.iter().all(|j| j.fusionauth_user_id == FUSION));
    // Newest-first ordering.
    assert!(
        jobs.windows(2).all(|w| w[0].created_at >= w[1].created_at),
        "jobs should be ordered newest-first"
    );

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn all_jobs_caps_at_100(pool: Pool<Postgres>) -> anyhow::Result<()> {
    const FUSION: &str = "fusion-cap-user";

    for _ in 0..105 {
        insert_job(&pool, FUSION, DbStatus::Complete, 0).await;
    }

    let jobs = get_all_jobs_by_fusionauth_user_id(&pool, FUSION).await?;

    assert_eq!(jobs.len(), 100, "result should be capped at LIMIT 100");

    Ok(())
}
