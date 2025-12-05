//! Tests for system properties PostgreSQL repository.

use super::*;
use crate::domain::model::SystemPropertyKey;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

/// Helper to count properties for an entity
async fn count_properties(pool: &Pool<Postgres>, entity_id: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM entity_properties WHERE entity_id = $1 AND entity_type = 'TASK'",
    )
    .bind(entity_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Helper to get property values for an entity
async fn get_property_values(
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_copy_task_properties_empty_source(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PgSystemPropertiesRepository::new(pool.clone());

    let from_task_id = "source-task-123";
    let to_task_id = "dest-task-456";

    // Copy from empty source - should still create system properties with null values
    repo.copy_task_properties(from_task_id, to_task_id).await?;

    // Should have 10 system properties with null values
    let count = count_properties(&pool, to_task_id).await;
    assert_eq!(count, 10, "Should have 10 system task properties");

    // All values should be null
    let properties = get_property_values(&pool, to_task_id).await;
    for (_, value) in &properties {
        assert!(value.is_none(), "All properties should be null");
    }

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_copy_task_properties_with_existing_properties(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgSystemPropertiesRepository::new(pool.clone());

    let from_task_id = "source-task-with-props";
    let to_task_id = "dest-task-new";

    // Insert some properties on the source task
    let status_value = serde_json::json!({"type": "String", "value": "In Progress"});
    let priority_value = serde_json::json!({"type": "String", "value": "High"});

    sqlx::query(
        r#"
        INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
        VALUES 
            (gen_random_uuid(), $1, 'TASK', $2, $3),
            (gen_random_uuid(), $1, 'TASK', $4, $5)
        "#,
    )
    .bind(from_task_id)
    .bind(SystemPropertyKey::Status.uuid())
    .bind(&status_value)
    .bind(SystemPropertyKey::Priority.uuid())
    .bind(&priority_value)
    .execute(&pool)
    .await?;

    // Copy properties
    repo.copy_task_properties(from_task_id, to_task_id).await?;

    // Destination should have 10 properties (2 copied + 8 null system properties)
    let count = count_properties(&pool, to_task_id).await;
    assert_eq!(count, 10, "Should have 10 properties");

    // Check that status and priority were copied with values
    let properties = get_property_values(&pool, to_task_id).await;

    let status_prop = properties
        .iter()
        .find(|(id, _)| *id == SystemPropertyKey::Status.uuid());
    assert!(status_prop.is_some(), "Status property should exist");
    assert_eq!(
        status_prop.unwrap().1.as_ref().unwrap(),
        &status_value,
        "Status value should be copied"
    );

    let priority_prop = properties
        .iter()
        .find(|(id, _)| *id == SystemPropertyKey::Priority.uuid());
    assert!(priority_prop.is_some(), "Priority property should exist");
    assert_eq!(
        priority_prop.unwrap().1.as_ref().unwrap(),
        &priority_value,
        "Priority value should be copied"
    );

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_copy_task_properties_overwrites_existing(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PgSystemPropertiesRepository::new(pool.clone());

    let from_task_id = "source-task-overwrite";
    let to_task_id = "dest-task-existing";

    // Insert property on source
    let source_value = serde_json::json!({"type": "String", "value": "Source Value"});
    sqlx::query(
        r#"
        INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
        VALUES (gen_random_uuid(), $1, 'TASK', $2, $3)
        "#,
    )
    .bind(from_task_id)
    .bind(SystemPropertyKey::Status.uuid())
    .bind(&source_value)
    .execute(&pool)
    .await?;

    // Insert different property on destination
    let dest_value = serde_json::json!({"type": "String", "value": "Dest Value"});
    sqlx::query(
        r#"
        INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
        VALUES (gen_random_uuid(), $1, 'TASK', $2, $3)
        "#,
    )
    .bind(to_task_id)
    .bind(SystemPropertyKey::Status.uuid())
    .bind(&dest_value)
    .execute(&pool)
    .await?;

    // Copy should overwrite destination value
    repo.copy_task_properties(from_task_id, to_task_id).await?;

    let properties = get_property_values(&pool, to_task_id).await;
    let status_prop = properties
        .iter()
        .find(|(id, _)| *id == SystemPropertyKey::Status.uuid());

    assert_eq!(
        status_prop.unwrap().1.as_ref().unwrap(),
        &source_value,
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
    let count = count_properties(&pool, to_task_id).await;
    assert_eq!(
        count, 10,
        "Should have exactly 10 properties after idempotent copies"
    );

    Ok(())
}
