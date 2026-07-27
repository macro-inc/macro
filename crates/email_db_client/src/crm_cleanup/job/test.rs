use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_job_dedupes_active_job(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let first = create_job(&pool, 10, 100).await?;
    assert!(first.is_some(), "first create should insert a job");

    let second = create_job(&pool, 20, 200).await?;
    assert!(
        second.is_none(),
        "second create should no-op while a job is active"
    );

    // The active job is the first one.
    let first_id = first.unwrap().id;
    let active = get_active_job(&pool).await?;
    assert_eq!(active.map(|j| j.id), Some(first_id));

    // Once the active job finishes, a new one can be created.
    set_job_status(&pool, first_id, CrmCleanupJobStatus::Complete).await?;
    assert!(get_active_job(&pool).await?.is_none());
    let third = create_job(&pool, 20, 200).await?;
    assert!(third.is_some(), "create should succeed after completion");

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn job_counters_and_status_roundtrip(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let job = create_job(&pool, 5, 50).await?.unwrap();
    assert_eq!(job.total_candidates, 5);
    assert_eq!(job.max_candidate_id, 50);
    assert_eq!(job.dispatched_count, 0);
    assert_eq!(job.status, CrmCleanupJobStatus::Init);

    set_job_status(&pool, job.id, CrmCleanupJobStatus::InProgress).await?;
    add_dispatched_count(&pool, job.id, 3).await?;
    add_dispatched_count(&pool, job.id, 2).await?;

    let fetched = get_job(&pool, job.id).await?.unwrap();
    assert_eq!(fetched.dispatched_count, 5);
    assert_eq!(fetched.status, CrmCleanupJobStatus::InProgress);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn job_updates_fail_for_unknown_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let missing = Uuid::new_v4();
    assert!(add_dispatched_count(&pool, missing, 1).await.is_err());
    assert!(
        set_job_status(&pool, missing, CrmCleanupJobStatus::Failed)
            .await
            .is_err()
    );
    assert!(get_job(&pool, missing).await?.is_none());

    Ok(())
}
