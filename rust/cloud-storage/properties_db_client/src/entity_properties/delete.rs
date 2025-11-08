//! Entity property delete operations.

use crate::error::PropertiesDatabaseError;
use models_properties::EntityReference;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

type Result<T> = std::result::Result<T, PropertiesDatabaseError>;

/// Deletes an entity property by its ID.
#[tracing::instrument(skip(db))]
pub async fn delete_entity_property(db: &Pool<Postgres>, entity_property_id: Uuid) -> Result<()> {
    sqlx::query!(
        "DELETE FROM entity_properties WHERE id = $1",
        entity_property_id
    )
    .execute(db)
    .await?;

    Ok(())
}

/// Deletes an entity.
#[tracing::instrument(skip(db))]
pub async fn delete_entity(db: &Pool<Postgres>, entity_reference: &EntityReference) -> Result<()> {
    sqlx::query!(
        "DELETE FROM entity_properties WHERE entity_id = $1 AND entity_type = $2",
        entity_reference.entity_id,
        entity_reference.entity_type as _,
    )
    .execute(db)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use models_properties::EntityType;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_delete_entity_property(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let entity_property_id = "e0111111-1111-1111-1111-111111111111"
            .parse::<Uuid>()
            .unwrap();

        // Verify entity has properties before deletion
        let properties_before = crate::entity_properties::get::get_entity_properties_values(
            &pool,
            "doc1",
            EntityType::Document,
        )
        .await?;
        let initial_count = properties_before.len();
        assert!(initial_count > 0);

        // Delete the entity property
        delete_entity_property(&pool, entity_property_id).await?;

        // Verify it was deleted
        let properties_after = crate::entity_properties::get::get_entity_properties_values(
            &pool,
            "doc1",
            EntityType::Document,
        )
        .await?;
        assert_eq!(properties_after.len(), initial_count - 1);

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_delete_nonexistent_entity_property(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let entity_property_id = "00000000-0000-0000-0000-000000000000"
            .parse::<Uuid>()
            .unwrap();

        // Deleting non-existent entity property should succeed (no error)
        let result = delete_entity_property(&pool, entity_property_id).await;
        assert!(result.is_ok());

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_delete_entity(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let entity_ref = EntityReference {
            entity_id: "doc1".to_string(),
            entity_type: EntityType::Document,
        };

        // Verify entity has properties before deletion
        let properties_before = crate::entity_properties::get::get_entity_properties_values(
            &pool,
            "doc1",
            EntityType::Document,
        )
        .await?;
        assert!(properties_before.len() > 0);

        // Delete all properties for the entity
        delete_entity(&pool, &entity_ref).await?;

        // Verify all properties were deleted
        let properties_after = crate::entity_properties::get::get_entity_properties_values(
            &pool,
            "doc1",
            EntityType::Document,
        )
        .await?;
        assert_eq!(properties_after.len(), 0);

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_delete_entity_only_deletes_specific_entity(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let entity_ref = EntityReference {
            entity_id: "doc1".to_string(),
            entity_type: EntityType::Document,
        };

        // Get properties for doc2 before deletion
        let doc2_properties_before = crate::entity_properties::get::get_entity_properties_values(
            &pool,
            "doc2",
            EntityType::Document,
        )
        .await?;
        let doc2_count_before = doc2_properties_before.len();

        // Delete doc1
        delete_entity(&pool, &entity_ref).await?;

        // Verify doc2 properties are unchanged
        let doc2_properties_after = crate::entity_properties::get::get_entity_properties_values(
            &pool,
            "doc2",
            EntityType::Document,
        )
        .await?;
        assert_eq!(doc2_properties_after.len(), doc2_count_before);

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_delete_nonexistent_entity(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let entity_ref = EntityReference {
            entity_id: "nonexistent".to_string(),
            entity_type: EntityType::Document,
        };

        // Deleting non-existent entity should succeed (no error)
        let result = delete_entity(&pool, &entity_ref).await;
        assert!(result.is_ok());

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_delete_entity_by_entity_type(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        // Delete all document entities
        let doc1_ref = EntityReference {
            entity_id: "doc1".to_string(),
            entity_type: EntityType::Document,
        };
        let doc2_ref = EntityReference {
            entity_id: "doc2".to_string(),
            entity_type: EntityType::Document,
        };

        // Verify documents have no properties
        let doc1_before = crate::entity_properties::get::get_entity_properties_values(
            &pool,
            "doc1",
            EntityType::Document,
        )
        .await?;
        let doc2_before = crate::entity_properties::get::get_entity_properties_values(
            &pool,
            "doc2",
            EntityType::Document,
        )
        .await?;
        assert!(doc1_before.len() > 0);
        assert!(doc2_before.len() > 0);

        let proj1_before = crate::entity_properties::get::get_entity_properties_values(
            &pool,
            "proj1",
            EntityType::Project,
        )
        .await?;
        assert!(proj1_before.len() > 0);

        delete_entity(&pool, &doc1_ref).await?;
        delete_entity(&pool, &doc2_ref).await?;

        // Verify documents have no properties
        let doc1_after = crate::entity_properties::get::get_entity_properties_values(
            &pool,
            "doc1",
            EntityType::Document,
        )
        .await?;
        let doc2_after = crate::entity_properties::get::get_entity_properties_values(
            &pool,
            "doc2",
            EntityType::Document,
        )
        .await?;
        assert_eq!(doc1_after.len(), 0);
        assert_eq!(doc2_after.len(), 0);

        // Verify project properties still exist
        let proj1_after = crate::entity_properties::get::get_entity_properties_values(
            &pool,
            "proj1",
            EntityType::Project,
        )
        .await?;
        assert_eq!(proj1_after.len(), proj1_before.len());

        Ok(())
    }
}
