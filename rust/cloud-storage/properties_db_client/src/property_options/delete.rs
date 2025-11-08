//! Property options delete operations.

use crate::error::PropertiesDatabaseError;
use sqlx::{Pool, Postgres};

type Result<T> = std::result::Result<T, PropertiesDatabaseError>;

/// Deletes a property option.
/// Returns Ok(true) if the option was deleted, Ok(false) if it didn't exist.
#[tracing::instrument(skip(db))]
pub async fn delete_property_option(
    db: &Pool<Postgres>,
    property_option_id: uuid::Uuid,
) -> Result<bool> {
    let result = sqlx::query!(
        "DELETE FROM property_options WHERE id = $1",
        property_option_id
    )
    .execute(db)
    .await?;

    Ok(result.rows_affected() > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_delete_property_option(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let option_id = "10111111-1111-1111-1111-111111111111"
            .parse::<uuid::Uuid>()
            .unwrap();

        // Verify it exists
        let option_before =
            crate::property_options::get::get_property_option_by_id(&pool, option_id).await?;
        assert!(option_before.is_some());

        // Delete it
        let deleted = delete_property_option(&pool, option_id).await?;
        assert!(deleted);

        // Verify it's gone
        let option_after =
            crate::property_options::get::get_property_option_by_id(&pool, option_id).await?;
        assert!(option_after.is_none());

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_delete_nonexistent_property_option(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let option_id = "00000000-0000-0000-0000-000000000000"
            .parse::<uuid::Uuid>()
            .unwrap();

        // Deleting non-existent option should return false
        let deleted = delete_property_option(&pool, option_id).await?;
        assert!(!deleted);

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_delete_property_option_reduces_count(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "11111111-1111-1111-1111-111111111111"
            .parse::<uuid::Uuid>()
            .unwrap();
        let option_id = "10111111-1111-1111-1111-111111111111"
            .parse::<uuid::Uuid>()
            .unwrap();

        // Get initial count
        let options_before =
            crate::property_options::get::get_property_options(&pool, property_id).await?;
        let count_before = options_before.len();

        // Delete one option
        delete_property_option(&pool, option_id).await?;

        // Verify count decreased
        let options_after =
            crate::property_options::get::get_property_options(&pool, property_id).await?;
        let count_after = options_after.len();

        assert_eq!(count_after, count_before - 1);

        Ok(())
    }
}
