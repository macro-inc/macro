//! Property definitions delete operations.

use crate::error::PropertiesDatabaseError;
use sqlx::{Pool, Postgres};

type Result<T> = std::result::Result<T, PropertiesDatabaseError>;

/// Deletes a property definition and all associated data (cascades).
#[tracing::instrument(skip(db))]
pub async fn delete_property_definition(
    db: &Pool<Postgres>,
    property_definition_id: uuid::Uuid,
) -> Result<()> {
    sqlx::query!(
        "DELETE FROM property_definitions WHERE id = $1",
        property_definition_id
    )
    .execute(db)
    .await?;

    Ok(())
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
    async fn test_delete_property_definition(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "11111111-1111-1111-1111-111111111111"
            .parse::<uuid::Uuid>()
            .unwrap();

        // Verify it exists
        let property_before =
            crate::property_definitions::get::get_property_definition(&pool, property_id).await?;
        assert!(property_before.is_some());

        // Delete it
        delete_property_definition(&pool, property_id).await?;

        // Verify it's gone
        let property_after =
            crate::property_definitions::get::get_property_definition(&pool, property_id).await?;
        assert!(property_after.is_none());

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_delete_property_definition_cascades_options(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "11111111-1111-1111-1111-111111111111"
            .parse::<uuid::Uuid>()
            .unwrap();

        // Verify options exist
        let options_before =
            crate::property_options::get::get_property_options(&pool, property_id).await?;
        assert!(!options_before.is_empty());

        // Delete property definition
        delete_property_definition(&pool, property_id).await?;

        // Verify options are also deleted (cascade)
        let options_after =
            crate::property_options::get::get_property_options(&pool, property_id).await?;
        assert!(options_after.is_empty());

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_delete_property_definition_cascades_entity_properties(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "11111111-1111-1111-1111-111111111111"
            .parse::<uuid::Uuid>()
            .unwrap();

        // Verify entity properties exist for this definition
        let entity_props_before = crate::entity_properties::get::get_entity_properties_values(
            &pool,
            "doc1",
            models_properties::EntityType::Document,
        )
        .await?;
        let has_property_before = entity_props_before
            .iter()
            .any(|ep| ep.definition.id == property_id);
        assert!(has_property_before);

        // Delete property definition
        delete_property_definition(&pool, property_id).await?;

        // Verify entity properties are also deleted (cascade)
        let entity_props_after = crate::entity_properties::get::get_entity_properties_values(
            &pool,
            "doc1",
            models_properties::EntityType::Document,
        )
        .await?;
        let has_property_after = entity_props_after
            .iter()
            .any(|ep| ep.definition.id == property_id);
        assert!(!has_property_after);

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_delete_nonexistent_property_definition(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "00000000-0000-0000-0000-000000000000"
            .parse::<uuid::Uuid>()
            .unwrap();

        // Deleting non-existent property should succeed (no error)
        let result = delete_property_definition(&pool, property_id).await;
        assert!(result.is_ok());

        Ok(())
    }
}
