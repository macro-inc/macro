use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_insert_and_get_mobile_welcome_email(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let email = "Test@Example.com";

    // Should not exist initially
    assert!(!get_mobile_welcome_email(&pool, email).await?);

    // Insert returns true on first insert
    assert!(insert_mobile_welcome_email(&pool, email).await?);

    // Should exist now (case-insensitive)
    assert!(get_mobile_welcome_email(&pool, email).await?);
    assert!(get_mobile_welcome_email(&pool, "test@example.com").await?);

    // Duplicate insert returns false
    assert!(!insert_mobile_welcome_email(&pool, email).await?);

    Ok(())
}
