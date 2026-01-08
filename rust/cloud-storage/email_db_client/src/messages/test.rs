use crate::messages::get::draft_exists_with_id;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("draft_exists_with_id"))
)]
async fn draft_exists_with_id_returns_true_for_existing_draft(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000e01")?;
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000e501")?;

    let exists = draft_exists_with_id(&pool, link_id, draft_id).await?;

    assert!(exists);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("draft_exists_with_id"))
)]
async fn draft_exists_with_id_returns_false_for_non_draft_message(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000e01")?;
    let non_draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000e502")?;

    let exists = draft_exists_with_id(&pool, link_id, non_draft_id).await?;

    assert!(!exists);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("draft_exists_with_id"))
)]
async fn draft_exists_with_id_returns_false_for_wrong_link_id(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let wrong_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000e02")?;
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000e501")?;

    let exists = draft_exists_with_id(&pool, wrong_link_id, draft_id).await?;

    assert!(!exists);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("draft_exists_with_id"))
)]
async fn draft_exists_with_id_returns_false_for_nonexistent_message(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000e01")?;
    let nonexistent_id = Uuid::parse_str("00000000-0000-0000-0000-00000000efff")?;

    let exists = draft_exists_with_id(&pool, link_id, nonexistent_id).await?;

    assert!(!exists);

    Ok(())
}
