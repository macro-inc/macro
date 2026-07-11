//! Tests for system properties PostgreSQL repository.

use models_properties::EntityType;

use super::*;
use crate::domain::model::{PropertyRow, SystemPropertyKey};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

/// Helper to count task properties
async fn count_task_properties(pool: &Pool<Postgres>, entity_id: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM entity_properties WHERE entity_id = $1 AND entity_type = 'TASK'",
    )
    .bind(entity_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Helper to get task property values
async fn get_task_property_values(
    pool: &Pool<Postgres>,
    entity_id: &str,
) -> Vec<(Uuid, Option<serde_json::Value>)> {
    sqlx::query_as::<_, (Uuid, Option<serde_json::Value>)>(
        "SELECT property_definition_id, values FROM entity_properties WHERE entity_id = $1 AND entity_type = 'TASK' ORDER BY property_definition_id",
    )
    .bind(entity_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

// ============================================================================
// bulk_upsert_properties tests
// ============================================================================

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_bulk_upsert_properties_insert(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PgSystemPropertiesRepository::new(pool.clone());

    let entity_id = "test-task-insert";
    let rows = vec![
        PropertyRow::null_value(
            entity_id,
            EntityType::Task,
            SystemPropertyKey::Status.uuid(),
        ),
        PropertyRow::null_value(
            entity_id,
            EntityType::Task,
            SystemPropertyKey::Priority.uuid(),
        ),
    ];

    repo.bulk_upsert_properties(rows).await?;

    let count = count_task_properties(&pool, entity_id).await;
    assert_eq!(count, 2, "Should have inserted 2 properties");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("system_properties"))
)]
async fn test_bulk_upsert_properties_update(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PgSystemPropertiesRepository::new(pool.clone());

    let entity_id = "source-task-with-props";
    let custom_notes_id: Uuid = "cccccccc-cccc-cccc-cccc-cccccccccc01".parse().unwrap();

    // Update Custom Notes (STRING type) - already has "This is a custom note" from fixture
    let rows = vec![PropertyRow::string_value(
        entity_id,
        EntityType::Task,
        custom_notes_id,
        "Updated note",
    )];

    repo.bulk_upsert_properties(rows).await?;

    let properties = get_task_property_values(&pool, entity_id).await;
    let notes_prop = properties.iter().find(|(id, _)| *id == custom_notes_id);

    assert_eq!(
        notes_prop.unwrap().1.as_ref().unwrap(),
        &serde_json::json!({"type": "String", "value": "Updated note"}),
        "Custom Notes should be updated"
    );

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_bulk_upsert_properties_empty(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PgSystemPropertiesRepository::new(pool.clone());

    // Empty input should succeed without error
    repo.bulk_upsert_properties(vec![]).await?;

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_bulk_upsert_properties_multiple_entities(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PgSystemPropertiesRepository::new(pool.clone());

    let rows = vec![
        PropertyRow::null_value("task-a", EntityType::Task, SystemPropertyKey::Status.uuid()),
        PropertyRow::null_value(
            "task-a",
            EntityType::Task,
            SystemPropertyKey::Priority.uuid(),
        ),
        PropertyRow::null_value("task-b", EntityType::Task, SystemPropertyKey::Status.uuid()),
        PropertyRow::null_value("task-c", EntityType::Task, SystemPropertyKey::Status.uuid()),
    ];

    repo.bulk_upsert_properties(rows).await?;

    assert_eq!(count_task_properties(&pool, "task-a").await, 2);
    assert_eq!(count_task_properties(&pool, "task-b").await, 1);
    assert_eq!(count_task_properties(&pool, "task-c").await, 1);

    Ok(())
}

// ============================================================================
// copy_task_properties tests
// ============================================================================

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_copy_task_properties_empty_source(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PgSystemPropertiesRepository::new(pool.clone());

    let from_task_id = "source-task-123";
    let to_task_id = "dest-task-456";

    // Copy from empty source - should still create system properties with null values
    repo.copy_task_properties(from_task_id, to_task_id).await?;

    // Should have 10 system properties with null values
    let count = count_task_properties(&pool, to_task_id).await;
    assert_eq!(count, 10, "Should have 10 system task properties");

    // All values should be null
    let properties = get_task_property_values(&pool, to_task_id).await;
    for (_, value) in &properties {
        assert!(value.is_none(), "All properties should be null");
    }

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("system_properties"))
)]
async fn test_copy_task_properties_with_existing_properties(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgSystemPropertiesRepository::new(pool.clone());

    let from_task_id = "source-task-with-props";
    let to_task_id = "dest-task-new";

    // Copy properties (source has 2 system + 2 custom properties from fixture)
    repo.copy_task_properties(from_task_id, to_task_id).await?;

    // Destination should have 12 properties:
    // - 4 copied (Status, Priority, Custom Notes, Custom Tags)
    // - 8 null system properties backfilled
    let count = count_task_properties(&pool, to_task_id).await;
    assert_eq!(
        count, 12,
        "Should have 12 properties (4 copied + 8 backfilled)"
    );

    // Check that status was copied with correct SelectOption value
    let properties = get_task_property_values(&pool, to_task_id).await;

    let status_prop = properties
        .iter()
        .find(|(id, _)| *id == SystemPropertyKey::Status.uuid());
    assert!(status_prop.is_some(), "Status property should exist");
    assert_eq!(
        status_prop.unwrap().1.as_ref().unwrap(),
        &serde_json::json!({"type": "SelectOption", "value": ["00000001-0000-0000-0002-000000000002"]}), // In Progress
        "Status value should be copied"
    );

    let priority_prop = properties
        .iter()
        .find(|(id, _)| *id == SystemPropertyKey::Priority.uuid());
    assert!(priority_prop.is_some(), "Priority property should exist");
    assert_eq!(
        priority_prop.unwrap().1.as_ref().unwrap(),
        &serde_json::json!({"type": "SelectOption", "value": ["00000001-0000-0000-0003-000000000003"]}), // High
        "Priority value should be copied"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("system_properties"))
)]
async fn test_copy_task_properties_copies_custom_properties(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgSystemPropertiesRepository::new(pool.clone());

    let from_task_id = "source-task-with-props";
    let to_task_id = "dest-task-custom";

    // Custom property IDs from fixture
    let custom_notes_id: Uuid = "cccccccc-cccc-cccc-cccc-cccccccccc01".parse().unwrap();
    let custom_tags_id: Uuid = "cccccccc-cccc-cccc-cccc-cccccccccc02".parse().unwrap();

    repo.copy_task_properties(from_task_id, to_task_id).await?;

    let properties = get_task_property_values(&pool, to_task_id).await;

    // Check Custom Notes was copied
    let notes_prop = properties.iter().find(|(id, _)| *id == custom_notes_id);
    assert!(
        notes_prop.is_some(),
        "Custom Notes property should be copied"
    );
    assert_eq!(
        notes_prop.unwrap().1.as_ref().unwrap(),
        &serde_json::json!({"type": "String", "value": "This is a custom note"}),
        "Custom Notes value should be copied"
    );

    // Check Custom Tags was copied
    let tags_prop = properties.iter().find(|(id, _)| *id == custom_tags_id);
    assert!(tags_prop.is_some(), "Custom Tags property should be copied");
    assert_eq!(
        tags_prop.unwrap().1.as_ref().unwrap(),
        &serde_json::json!({"type": "SelectOption", "value": ["00000000-0000-0000-0000-000000000101"]}), // urgent
        "Custom Tags value should be copied"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("system_properties"))
)]
async fn test_copy_task_properties_overwrites_existing(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PgSystemPropertiesRepository::new(pool.clone());

    let from_task_id = "source-task-overwrite"; // Status = Completed
    let to_task_id = "dest-task-existing"; // Status = Not Started

    // Copy should overwrite destination value
    repo.copy_task_properties(from_task_id, to_task_id).await?;

    let properties = get_task_property_values(&pool, to_task_id).await;
    let status_prop = properties
        .iter()
        .find(|(id, _)| *id == SystemPropertyKey::Status.uuid());

    assert_eq!(
        status_prop.unwrap().1.as_ref().unwrap(),
        &serde_json::json!({"type": "SelectOption", "value": ["00000001-0000-0000-0002-000000000004"]}), // Completed (from source)
        "Destination value should be overwritten with source value"
    );

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_copy_task_properties_idempotent(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PgSystemPropertiesRepository::new(pool.clone());

    let from_task_id = "source-task-idempotent";
    let to_task_id = "dest-task-idempotent";

    // Copy twice
    repo.copy_task_properties(from_task_id, to_task_id).await?;
    repo.copy_task_properties(from_task_id, to_task_id).await?;

    // Should still have exactly 10 properties
    let count = count_task_properties(&pool, to_task_id).await;
    assert_eq!(
        count, 10,
        "Should have exactly 10 properties after idempotent copies"
    );

    Ok(())
}
