use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_create_and_get_id_mapping(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // Create a mapping
    create_id_mapping(&pool, "source-123", "target-456").await?;

    // Get the mapping
    let target = get_id_mapping(&pool, "source-123").await?;
    assert_eq!(target, Some("target-456".to_string()));

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_get_nonexistent_mapping(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let target = get_id_mapping(&pool, "nonexistent").await?;
    assert_eq!(target, None);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_upsert_id_mapping(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // Create initial mapping
    create_id_mapping(&pool, "source-abc", "target-old").await?;

    // Update the mapping
    create_id_mapping(&pool, "source-abc", "target-new").await?;

    // Verify it was updated
    let target = get_id_mapping(&pool, "source-abc").await?;
    assert_eq!(target, Some("target-new".to_string()));

    Ok(())
}
