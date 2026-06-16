use super::create_backfill_job;
use crate::backfill::job::get::get_active_backfill_job;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres};

async fn insert_link(pool: &Pool<Postgres>, link_id: Uuid) {
    sqlx::query!(
        r#"INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
           VALUES ($1, $2, $2, $3, 'GMAIL')"#,
        link_id,
        "macro|conflict@corp.test",
        "conflict@corp.test",
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_backfill_job_dedupes_active_job(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::new_v4();
    insert_link(&pool, link_id).await;

    let first = create_backfill_job(&pool, link_id, "fusion-x", None).await?;
    assert!(first.is_some(), "first create should insert a job");

    // A second create while one is active no-ops (partial unique index) and returns None.
    let second = create_backfill_job(&pool, link_id, "fusion-x", None).await?;
    assert!(
        second.is_none(),
        "second create should no-op while a job is active"
    );

    // Exactly one active job exists, and it is the first one.
    let active = get_active_backfill_job(&pool, link_id).await?;
    assert_eq!(active.map(|j| j.id), first.map(|j| j.id));

    Ok(())
}
