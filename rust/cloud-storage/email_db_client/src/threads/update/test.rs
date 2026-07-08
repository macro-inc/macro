use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

const THREAD_WITH_ICS: &str = "00000000-0000-0000-0000-00000000b201";
const THREAD_STALE_TRUE_PDF_ONLY: &str = "00000000-0000-0000-0000-00000000b202";

async fn fetch_flag(pool: &Pool<Postgres>, thread_id: &str) -> anyhow::Result<bool> {
    Ok(sqlx::query_scalar!(
        "SELECT has_calendar_attachment FROM email_threads WHERE id = $1",
        Uuid::parse_str(thread_id)?
    )
    .fetch_one(pool)
    .await?)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sync_thread_calendar_flag"))
)]
async fn sync_sets_flag_when_thread_has_calendar_attachment(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    assert!(!fetch_flag(&pool, THREAD_WITH_ICS).await?);

    let mut conn = pool.acquire().await?;
    sync_thread_calendar_flag(&mut conn, Uuid::parse_str(THREAD_WITH_ICS)?).await?;

    assert!(fetch_flag(&pool, THREAD_WITH_ICS).await?);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sync_thread_calendar_flag"))
)]
async fn sync_clears_stale_flag_when_no_calendar_attachment(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // Fixture marks this thread true even though its only attachment is a PDF.
    assert!(fetch_flag(&pool, THREAD_STALE_TRUE_PDF_ONLY).await?);

    let mut conn = pool.acquire().await?;
    sync_thread_calendar_flag(&mut conn, Uuid::parse_str(THREAD_STALE_TRUE_PDF_ONLY)?).await?;

    assert!(!fetch_flag(&pool, THREAD_STALE_TRUE_PDF_ONLY).await?);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sync_thread_calendar_flag"))
)]
async fn sync_is_stable_when_flag_already_matches(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let thread_id = Uuid::parse_str(THREAD_WITH_ICS)?;
    let mut conn = pool.acquire().await?;
    sync_thread_calendar_flag(&mut conn, thread_id).await?;
    assert!(fetch_flag(&pool, THREAD_WITH_ICS).await?);

    // Re-sync with no attachment changes: the value must stay put.
    sync_thread_calendar_flag(&mut conn, thread_id).await?;
    assert!(fetch_flag(&pool, THREAD_WITH_ICS).await?);
    Ok(())
}
