//! Integration tests for PropertiesPgRepo using sqlx and real migrations.

use super::properties_pg_repo::PropertiesPgRepo;
use crate::domain::ports::PropertiesRepo;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_properties::{EntityType, service::property_value::PropertyValue};
use sqlx::{Pool, Postgres};
use system_properties::{StatusOption, SystemPropertyKey};
use uuid::Uuid;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties_seed"))
)]
async fn updates_existing_property(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());
    let entity_id = "entity-status-incomplete";
    let property_id = SystemPropertyKey::STATUS_UUID;

    // Update value to completed
    repo.update_entity_property_value_if_exists(
        entity_id,
        EntityType::Document,
        property_id,
        Some(PropertyValue::SelectOption(vec![
            StatusOption::COMPLETED_UUID,
        ])),
    )
    .await?;

    // Verify
    let stored: serde_json::Value = sqlx::query_scalar::<_, serde_json::Value>(
        r#"
        SELECT values FROM entity_properties
        WHERE entity_id = $1 AND entity_type = $2 AND property_definition_id = $3
        "#,
    )
    .bind(entity_id)
    .bind(EntityType::Document)
    .bind(property_id)
    .fetch_one(&pool)
    .await?;

    assert_eq!(
        stored,
        serde_json::json!({"type": "SelectOption", "value": [StatusOption::COMPLETED_UUID]})
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties_seed"))
)]
async fn no_op_when_property_not_attached(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());
    let entity_id = "entity-no-status";
    let property_id = SystemPropertyKey::STATUS_UUID;

    repo.update_entity_property_value_if_exists(
        entity_id,
        EntityType::Document,
        property_id,
        Some(PropertyValue::SelectOption(vec![
            StatusOption::COMPLETED_UUID,
        ])),
    )
    .await?;

    let count: i64 = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*) FROM entity_properties
        WHERE entity_id = $1 AND entity_type = $2 AND property_definition_id = $3
        "#,
    )
    .bind(entity_id)
    .bind(EntityType::Document)
    .bind(property_id)
    .fetch_one(&pool)
    .await?;

    assert_eq!(count, 0, "no rows should be created or updated");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties_seed"))
)]
async fn idempotent_when_already_completed(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());
    let entity_id = "entity-status-complete";
    let property_id = SystemPropertyKey::STATUS_UUID;

    repo.update_entity_property_value_if_exists(
        entity_id,
        EntityType::Document,
        property_id,
        Some(PropertyValue::SelectOption(vec![
            StatusOption::COMPLETED_UUID,
        ])),
    )
    .await?;

    let stored: serde_json::Value = sqlx::query_scalar::<_, serde_json::Value>(
        r#"
        SELECT values FROM entity_properties
        WHERE entity_id = $1 AND entity_type = $2 AND property_definition_id = $3
        "#,
    )
    .bind(entity_id)
    .bind(EntityType::Document)
    .bind(property_id)
    .fetch_one(&pool)
    .await?;

    assert_eq!(
        stored,
        serde_json::json!({"type": "SelectOption", "value": [StatusOption::COMPLETED_UUID]})
    );

    Ok(())
}

// ============================================================================
// Task linking tests - link_parent_task
// ============================================================================

/// Helper to get a task's parent from the database
async fn get_parent(pool: &Pool<Postgres>, task_id: &str) -> Option<String> {
    sqlx::query_scalar::<_, Option<String>>(
        r#"
        SELECT values->'value'->0->>'entity_id'
        FROM entity_properties
        WHERE entity_id = $1
          AND entity_type = 'TASK'
          AND property_definition_id = $2
          AND values IS NOT NULL
        "#,
    )
    .bind(task_id)
    .bind(SystemPropertyKey::PARENT_TASK_UUID)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .flatten()
}

/// Helper to get a task's subtasks from the database
async fn get_subtasks(pool: &Pool<Postgres>, task_id: &str) -> Vec<String> {
    sqlx::query_scalar::<_, String>(
        r#"
        SELECT elem->>'entity_id'
        FROM entity_properties,
             jsonb_array_elements(values->'value') elem
        WHERE entity_id = $1
          AND entity_type = 'TASK'
          AND property_definition_id = $2
          AND values IS NOT NULL
        "#,
    )
    .bind(task_id)
    .bind(SystemPropertyKey::SUBTASKS_UUID)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
}

/// Helper to parse task ID string to UUID
fn task_uuid(task_id: &str) -> Uuid {
    // For test fixtures, we use predictable UUIDs based on task name
    match task_id {
        "task-parent-a" => Uuid::from_u128(0x20000001_0000_0000_0000_000000000001),
        "task-parent-b" => Uuid::from_u128(0x20000001_0000_0000_0000_000000000002),
        "task-child-1" => Uuid::from_u128(0x20000001_0000_0000_0000_000000000003),
        "task-child-2" => Uuid::from_u128(0x20000001_0000_0000_0000_000000000004),
        "task-child-3" => Uuid::from_u128(0x20000001_0000_0000_0000_000000000005),
        "task-orphan" => Uuid::from_u128(0x20000001_0000_0000_0000_000000000006),
        "task-standalone" => Uuid::from_u128(0x20000001_0000_0000_0000_000000000007),
        _ => panic!("Unknown test task: {}", task_id),
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("task_linking_seed"))
)]
async fn link_parent_task_set_parent_on_orphan(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());

    // task-orphan has no parent, set it to task-parent-a
    let orphan_id = task_uuid("task-orphan");
    let parent_a_id = task_uuid("task-parent-a");

    // Verify initial state
    let initial_parent = get_parent(&pool, &orphan_id.to_string()).await;
    assert_eq!(initial_parent, None);

    let initial_subtasks = get_subtasks(&pool, &parent_a_id.to_string()).await;
    assert!(!initial_subtasks.contains(&orphan_id.to_string()));

    // Set parent
    repo.link_parent_task(orphan_id, Some(parent_a_id)).await?;

    // Verify: task-orphan's parent is now task-parent-a
    let parent = get_parent(&pool, &orphan_id.to_string()).await;
    assert_eq!(parent, Some(parent_a_id.to_string()));

    // Verify: task-parent-a's subtasks now includes task-orphan
    let subtasks = get_subtasks(&pool, &parent_a_id.to_string()).await;
    assert!(subtasks.contains(&orphan_id.to_string()));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("task_linking_seed"))
)]
async fn link_parent_task_change_parent(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());

    // task-child-1 has parent task-parent-a, change to task-parent-b
    let child_1_id = task_uuid("task-child-1");
    let parent_a_id = task_uuid("task-parent-a");
    let parent_b_id = task_uuid("task-parent-b");

    // Verify initial state
    let initial_parent = get_parent(&pool, &child_1_id.to_string()).await;
    assert_eq!(initial_parent, Some(parent_a_id.to_string()));

    let initial_a_subtasks = get_subtasks(&pool, &parent_a_id.to_string()).await;
    assert!(initial_a_subtasks.contains(&child_1_id.to_string()));

    // Change parent
    repo.link_parent_task(child_1_id, Some(parent_b_id)).await?;

    // Verify: task-child-1's parent is now task-parent-b
    let new_parent = get_parent(&pool, &child_1_id.to_string()).await;
    assert_eq!(new_parent, Some(parent_b_id.to_string()));

    // Verify: task-parent-a's subtasks no longer includes task-child-1
    let a_subtasks = get_subtasks(&pool, &parent_a_id.to_string()).await;
    assert!(!a_subtasks.contains(&child_1_id.to_string()));

    // Verify: task-parent-b's subtasks now includes task-child-1
    let b_subtasks = get_subtasks(&pool, &parent_b_id.to_string()).await;
    assert!(b_subtasks.contains(&child_1_id.to_string()));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("task_linking_seed"))
)]
async fn link_parent_task_clear_parent(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());

    // task-child-1 has parent task-parent-a, clear it
    let child_1_id = task_uuid("task-child-1");
    let parent_a_id = task_uuid("task-parent-a");

    // Verify initial state
    let initial_parent = get_parent(&pool, &child_1_id.to_string()).await;
    assert_eq!(initial_parent, Some(parent_a_id.to_string()));

    let initial_a_subtasks = get_subtasks(&pool, &parent_a_id.to_string()).await;
    assert!(initial_a_subtasks.contains(&child_1_id.to_string()));

    // Clear parent
    repo.link_parent_task(child_1_id, None).await?;

    // Verify: task-child-1's parent is now None
    let new_parent = get_parent(&pool, &child_1_id.to_string()).await;
    assert_eq!(new_parent, None);

    // Verify: task-parent-a's subtasks no longer includes task-child-1
    let a_subtasks = get_subtasks(&pool, &parent_a_id.to_string()).await;
    assert!(!a_subtasks.contains(&child_1_id.to_string()));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("task_linking_seed"))
)]
async fn link_parent_task_set_same_parent_is_noop(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());

    // task-child-1 has parent task-parent-a, set same parent
    let child_1_id = task_uuid("task-child-1");
    let parent_a_id = task_uuid("task-parent-a");

    // Verify initial state
    let initial_parent = get_parent(&pool, &child_1_id.to_string()).await;
    assert_eq!(initial_parent, Some(parent_a_id.to_string()));

    let initial_subtasks = get_subtasks(&pool, &parent_a_id.to_string()).await;
    assert!(initial_subtasks.contains(&child_1_id.to_string()));
    let initial_count = initial_subtasks.len();

    // Set same parent
    repo.link_parent_task(child_1_id, Some(parent_a_id)).await?;

    // Verify: parent unchanged
    let parent = get_parent(&pool, &child_1_id.to_string()).await;
    assert_eq!(parent, Some(parent_a_id.to_string()));

    // Verify: subtasks count unchanged (no duplicates)
    let subtasks = get_subtasks(&pool, &parent_a_id.to_string()).await;
    assert_eq!(subtasks.len(), initial_count);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("task_linking_seed"))
)]
async fn link_parent_task_nonexistent_task_is_noop(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());

    // Try to set parent on a task that doesn't exist
    let nonexistent_id = Uuid::from_u128(0x99999999_9999_9999_9999_999999999999);
    let parent_a_id = task_uuid("task-parent-a");

    // Verify initial state
    let initial_subtasks = get_subtasks(&pool, &parent_a_id.to_string()).await;
    assert!(!initial_subtasks.contains(&nonexistent_id.to_string()));

    // Should not error, just no-op
    repo.link_parent_task(nonexistent_id, Some(parent_a_id))
        .await?;

    // Verify: task-parent-a's subtasks unchanged
    let subtasks = get_subtasks(&pool, &parent_a_id.to_string()).await;
    assert!(!subtasks.contains(&nonexistent_id.to_string()));

    Ok(())
}

// ============================================================================
// Task linking tests - link_subtasks
// ============================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("task_linking_seed"))
)]
async fn link_subtasks_add_subtask(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());

    // task-parent-b has subtasks [task-child-3], add task-orphan
    let parent_b_id = task_uuid("task-parent-b");
    let child_3_id = task_uuid("task-child-3");
    let orphan_id = task_uuid("task-orphan");

    // Verify initial state
    let initial_subtasks = get_subtasks(&pool, &parent_b_id.to_string()).await;
    assert_eq!(initial_subtasks.len(), 1);
    assert!(initial_subtasks.contains(&child_3_id.to_string()));

    let initial_orphan_parent = get_parent(&pool, &orphan_id.to_string()).await;
    assert_eq!(initial_orphan_parent, None);

    // Add subtask
    repo.link_subtasks(parent_b_id, vec![child_3_id, orphan_id])
        .await?;

    // Verify: task-parent-b's subtasks now includes both
    let subtasks = get_subtasks(&pool, &parent_b_id.to_string()).await;
    assert!(subtasks.contains(&child_3_id.to_string()));
    assert!(subtasks.contains(&orphan_id.to_string()));

    // Verify: task-orphan's parent is now task-parent-b
    let orphan_parent = get_parent(&pool, &orphan_id.to_string()).await;
    assert_eq!(orphan_parent, Some(parent_b_id.to_string()));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("task_linking_seed"))
)]
async fn link_subtasks_remove_subtask(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());

    // task-parent-a has subtasks [task-child-1, task-child-2], remove task-child-1
    let parent_a_id = task_uuid("task-parent-a");
    let child_1_id = task_uuid("task-child-1");
    let child_2_id = task_uuid("task-child-2");

    // Verify initial state
    let initial_subtasks = get_subtasks(&pool, &parent_a_id.to_string()).await;
    assert_eq!(initial_subtasks.len(), 2);
    assert!(initial_subtasks.contains(&child_1_id.to_string()));
    assert!(initial_subtasks.contains(&child_2_id.to_string()));

    let initial_child_1_parent = get_parent(&pool, &child_1_id.to_string()).await;
    assert_eq!(initial_child_1_parent, Some(parent_a_id.to_string()));

    // Remove subtask
    repo.link_subtasks(parent_a_id, vec![child_2_id]).await?;

    // Verify: task-parent-a's subtasks only has task-child-2
    let subtasks = get_subtasks(&pool, &parent_a_id.to_string()).await;
    assert!(!subtasks.contains(&child_1_id.to_string()));
    assert!(subtasks.contains(&child_2_id.to_string()));

    // Verify: task-child-1's parent is now None
    let child_1_parent = get_parent(&pool, &child_1_id.to_string()).await;
    assert_eq!(child_1_parent, None);

    // Verify: task-child-2's parent is still task-parent-a
    let child_2_parent = get_parent(&pool, &child_2_id.to_string()).await;
    assert_eq!(child_2_parent, Some(parent_a_id.to_string()));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("task_linking_seed"))
)]
async fn link_subtasks_clear_all(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());

    // task-parent-a has subtasks [task-child-1, task-child-2], clear all
    let parent_a_id = task_uuid("task-parent-a");
    let child_1_id = task_uuid("task-child-1");
    let child_2_id = task_uuid("task-child-2");

    // Verify initial state
    let initial_subtasks = get_subtasks(&pool, &parent_a_id.to_string()).await;
    assert_eq!(initial_subtasks.len(), 2);
    assert!(initial_subtasks.contains(&child_1_id.to_string()));
    assert!(initial_subtasks.contains(&child_2_id.to_string()));

    // Clear all subtasks
    repo.link_subtasks(parent_a_id, vec![]).await?;

    // Verify: task-parent-a's subtasks is empty
    let subtasks = get_subtasks(&pool, &parent_a_id.to_string()).await;
    assert!(subtasks.is_empty());

    // Verify: both children's parent is now None
    let child_1_parent = get_parent(&pool, &child_1_id.to_string()).await;
    assert_eq!(child_1_parent, None);

    let child_2_parent = get_parent(&pool, &child_2_id.to_string()).await;
    assert_eq!(child_2_parent, None);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("task_linking_seed"))
)]
async fn link_subtasks_steal_from_other_parent(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());

    // task-child-3 belongs to task-parent-b
    // Move it to task-parent-a
    let parent_a_id = task_uuid("task-parent-a");
    let parent_b_id = task_uuid("task-parent-b");
    let child_1_id = task_uuid("task-child-1");
    let child_2_id = task_uuid("task-child-2");
    let child_3_id = task_uuid("task-child-3");

    // Verify initial state
    let initial_child_3_parent = get_parent(&pool, &child_3_id.to_string()).await;
    assert_eq!(initial_child_3_parent, Some(parent_b_id.to_string()));

    let initial_b_subtasks = get_subtasks(&pool, &parent_b_id.to_string()).await;
    assert!(initial_b_subtasks.contains(&child_3_id.to_string()));

    let initial_a_subtasks = get_subtasks(&pool, &parent_a_id.to_string()).await;
    assert!(!initial_a_subtasks.contains(&child_3_id.to_string()));

    // Set task-parent-a's subtasks to include task-child-3 (stealing it)
    repo.link_subtasks(parent_a_id, vec![child_1_id, child_2_id, child_3_id])
        .await?;

    // Verify: task-child-3's parent is now task-parent-a
    let child_3_parent = get_parent(&pool, &child_3_id.to_string()).await;
    assert_eq!(child_3_parent, Some(parent_a_id.to_string()));

    // Verify: task-parent-b's subtasks no longer includes task-child-3
    let b_subtasks = get_subtasks(&pool, &parent_b_id.to_string()).await;
    assert!(!b_subtasks.contains(&child_3_id.to_string()));

    // Verify: task-parent-a's subtasks includes all three
    let a_subtasks = get_subtasks(&pool, &parent_a_id.to_string()).await;
    assert!(a_subtasks.contains(&child_1_id.to_string()));
    assert!(a_subtasks.contains(&child_2_id.to_string()));
    assert!(a_subtasks.contains(&child_3_id.to_string()));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("task_linking_seed"))
)]
async fn link_subtasks_replace_all(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());

    // task-parent-a has subtasks [task-child-1, task-child-2]
    // Replace with [task-orphan, task-standalone]
    let parent_a_id = task_uuid("task-parent-a");
    let child_1_id = task_uuid("task-child-1");
    let child_2_id = task_uuid("task-child-2");
    let orphan_id = task_uuid("task-orphan");
    let standalone_id = task_uuid("task-standalone");

    // Verify initial state
    let initial_subtasks = get_subtasks(&pool, &parent_a_id.to_string()).await;
    assert_eq!(initial_subtasks.len(), 2);
    assert!(initial_subtasks.contains(&child_1_id.to_string()));
    assert!(initial_subtasks.contains(&child_2_id.to_string()));

    let initial_orphan_parent = get_parent(&pool, &orphan_id.to_string()).await;
    assert_eq!(initial_orphan_parent, None);

    let initial_standalone_parent = get_parent(&pool, &standalone_id.to_string()).await;
    assert_eq!(initial_standalone_parent, None);

    // Replace all subtasks
    repo.link_subtasks(parent_a_id, vec![orphan_id, standalone_id])
        .await?;

    // Verify: task-parent-a's subtasks is [task-orphan, task-standalone]
    let subtasks = get_subtasks(&pool, &parent_a_id.to_string()).await;
    assert!(!subtasks.contains(&child_1_id.to_string()));
    assert!(!subtasks.contains(&child_2_id.to_string()));
    assert!(subtasks.contains(&orphan_id.to_string()));
    assert!(subtasks.contains(&standalone_id.to_string()));

    // Verify: old children's parent is now None
    let child_1_parent = get_parent(&pool, &child_1_id.to_string()).await;
    assert_eq!(child_1_parent, None);

    let child_2_parent = get_parent(&pool, &child_2_id.to_string()).await;
    assert_eq!(child_2_parent, None);

    // Verify: new children's parent is task-parent-a
    let orphan_parent = get_parent(&pool, &orphan_id.to_string()).await;
    assert_eq!(orphan_parent, Some(parent_a_id.to_string()));

    let standalone_parent = get_parent(&pool, &standalone_id.to_string()).await;
    assert_eq!(standalone_parent, Some(parent_a_id.to_string()));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("task_linking_seed"))
)]
async fn link_subtasks_set_same_is_noop(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());

    // task-parent-a has subtasks [task-child-1, task-child-2], set same
    let parent_a_id = task_uuid("task-parent-a");
    let child_1_id = task_uuid("task-child-1");
    let child_2_id = task_uuid("task-child-2");

    // Verify initial state
    let initial_subtasks = get_subtasks(&pool, &parent_a_id.to_string()).await;
    assert_eq!(initial_subtasks.len(), 2);
    assert!(initial_subtasks.contains(&child_1_id.to_string()));
    assert!(initial_subtasks.contains(&child_2_id.to_string()));

    // Set same subtasks
    repo.link_subtasks(parent_a_id, vec![child_1_id, child_2_id])
        .await?;

    // Verify: subtasks unchanged
    let subtasks = get_subtasks(&pool, &parent_a_id.to_string()).await;
    assert_eq!(subtasks.len(), 2);
    assert!(subtasks.contains(&child_1_id.to_string()));
    assert!(subtasks.contains(&child_2_id.to_string()));

    // Verify: children's parent unchanged
    let child_1_parent = get_parent(&pool, &child_1_id.to_string()).await;
    assert_eq!(child_1_parent, Some(parent_a_id.to_string()));

    let child_2_parent = get_parent(&pool, &child_2_id.to_string()).await;
    assert_eq!(child_2_parent, Some(parent_a_id.to_string()));

    Ok(())
}

// ============================================================================
// Validation tests - circular reference prevention
// ============================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("task_linking_seed"))
)]
async fn link_parent_task_rejects_self_as_parent(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());

    let task_id = task_uuid("task-orphan");

    // Try to set self as parent - should fail
    let result = repo.link_parent_task(task_id, Some(task_id)).await;
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("cannot be its own parent")
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("task_linking_seed"))
)]
async fn link_subtasks_rejects_self_as_subtask(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());

    let task_id = task_uuid("task-orphan");

    // Try to include self in subtasks - should fail
    let result = repo.link_subtasks(task_id, vec![task_id]).await;
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("cannot be its own subtask")
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("task_linking_seed"))
)]
async fn link_parent_task_rejects_subtask_as_parent(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());

    // task-parent-a has subtasks [task-child-1, task-child-2]
    let parent_a_id = task_uuid("task-parent-a");
    let child_1_id = task_uuid("task-child-1");

    // Try to set a subtask as parent - should fail
    let result = repo.link_parent_task(parent_a_id, Some(child_1_id)).await;
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("circular reference")
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("task_linking_seed"))
)]
async fn link_subtasks_rejects_parent_as_subtask(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());

    // task-child-1 has parent task-parent-a
    let parent_a_id = task_uuid("task-parent-a");
    let child_1_id = task_uuid("task-child-1");

    // Try to set parent as subtask - should fail
    let result = repo.link_subtasks(child_1_id, vec![parent_a_id]).await;
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("circular reference")
    );

    Ok(())
}

// Tests for dynamically created mutual references

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("task_linking_seed"))
)]
async fn link_parent_then_add_as_subtask_fails(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());

    // Use two unrelated tasks
    let task_orphan = task_uuid("task-orphan");
    let task_standalone = task_uuid("task-standalone");

    // Step 1: Set task-standalone as parent of task-orphan
    // This means: task-orphan.parent = task-standalone, task-standalone.subtasks = [task-orphan]
    repo.link_parent_task(task_orphan, Some(task_standalone))
        .await?;

    // Step 2: Now try to add task-standalone as a subtask of task-orphan
    // This should fail because task-standalone is already task-orphan's parent
    let result = repo.link_subtasks(task_orphan, vec![task_standalone]).await;
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("circular reference")
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("task_linking_seed"))
)]
async fn link_subtask_then_set_as_parent_fails(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());

    // Use two unrelated tasks
    let task_orphan = task_uuid("task-orphan");
    let task_standalone = task_uuid("task-standalone");

    // Step 1: Add task-standalone as a subtask of task-orphan
    // This means: task-orphan.subtasks = [task-standalone], task-standalone.parent = task-orphan
    repo.link_subtasks(task_orphan, vec![task_standalone])
        .await?;

    // Step 2: Now try to set task-standalone as parent of task-orphan
    // This should fail because task-standalone is already task-orphan's subtask
    let result = repo
        .link_parent_task(task_orphan, Some(task_standalone))
        .await;
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("circular reference")
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("task_linking_seed"))
)]
async fn mutual_parent_link_fails(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());

    // Use two unrelated tasks
    let task_orphan = task_uuid("task-orphan");
    let task_standalone = task_uuid("task-standalone");

    // Step 1: Set task-standalone as parent of task-orphan
    // This means: task-orphan.parent = task-standalone, task-standalone.subtasks = [task-orphan]
    repo.link_parent_task(task_orphan, Some(task_standalone))
        .await?;

    // Step 2: Now try to set task-orphan as parent of task-standalone
    // This should fail because task-orphan is already in task-standalone's subtasks
    let result = repo
        .link_parent_task(task_standalone, Some(task_orphan))
        .await;
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("circular reference")
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("task_linking_seed"))
)]
async fn mutual_subtask_link_fails(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());

    // Use two unrelated tasks
    let task_orphan = task_uuid("task-orphan");
    let task_standalone = task_uuid("task-standalone");

    // Step 1: Add task-standalone as subtask of task-orphan
    // This means: task-orphan.subtasks = [task-standalone], task-standalone.parent = task-orphan
    repo.link_subtasks(task_orphan, vec![task_standalone])
        .await?;

    // Step 2: Now try to add task-orphan as subtask of task-standalone
    // This should fail because task-orphan is already task-standalone's parent
    let result = repo.link_subtasks(task_standalone, vec![task_orphan]).await;
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("circular reference")
    );

    Ok(())
}
