//! Integration tests for PropertiesPgRepo using sqlx and real migrations.

use super::properties_pg_repo::PropertiesPgRepo;
use crate::PropertiesServiceImpl;
use crate::domain::model::{EditReceipt, canonical_entity_type};
use crate::domain::ports::{MockNotificationService, MockPermissionService, PropertiesRepo};
use crate::domain::service::PropertiesService;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::EntityType;
use sqlx::{Pool, Postgres};
use std::sync::Arc;
use system_properties::SystemPropertyKey;
use uuid::Uuid;

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

/// Seeds an ownerless system multi-select select-string property definition and
/// returns its id. is_system satisfies the single-owner constraint without
/// needing a team/user row.
async fn seed_multi_select_definition(pool: &Pool<Postgres>, display_name: &str) -> Uuid {
    let def_id = macro_uuid::generate_uuid_v7();
    sqlx::query(
        r#"
        INSERT INTO property_definitions (id, display_name, data_type, is_multi_select, is_system)
        VALUES ($1, $2, 'SELECT_STRING', true, true)
        "#,
    )
    .bind(def_id)
    .bind(display_name)
    .execute(pool)
    .await
    .expect("seed definition");
    def_id
}

async fn read_select_value(
    pool: &Pool<Postgres>,
    entity_id: &str,
    def_id: Uuid,
) -> serde_json::Value {
    sqlx::query_scalar::<_, serde_json::Value>(
        r#"
        SELECT values FROM entity_properties
        WHERE entity_id = $1 AND entity_type = $2 AND property_definition_id = $3
        "#,
    )
    .bind(entity_id)
    .bind(EntityType::Document)
    .bind(def_id)
    .fetch_one(pool)
    .await
    .expect("read value")
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties_seed"))
)]
async fn add_option_attaches_appends_and_dedupes(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());
    let def_id = seed_multi_select_definition(&pool, "Test Tags Add").await;
    let entity_id = "entity-tags-add";
    let opt_a = macro_uuid::generate_uuid_v7();
    let opt_b = macro_uuid::generate_uuid_v7();

    // First add attaches the property and creates the value.
    repo.add_entity_property_option(entity_id, EntityType::Document, def_id, opt_a)
        .await?;
    // Second add appends to the current stored value.
    repo.add_entity_property_option(entity_id, EntityType::Document, def_id, opt_b)
        .await?;
    // Re-adding a present option is a no-op.
    repo.add_entity_property_option(entity_id, EntityType::Document, def_id, opt_a)
        .await?;

    assert_eq!(
        read_select_value(&pool, entity_id, def_id).await,
        serde_json::json!({"type": "SelectOption", "value": [opt_a, opt_b]})
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties_seed"))
)]
async fn remove_option_strips_and_is_tolerant(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());
    let def_id = seed_multi_select_definition(&pool, "Test Tags Remove").await;
    let entity_id = "entity-tags-remove";
    let opt_a = macro_uuid::generate_uuid_v7();
    let opt_b = macro_uuid::generate_uuid_v7();
    let opt_c = macro_uuid::generate_uuid_v7();

    for opt in [opt_a, opt_b, opt_c] {
        repo.add_entity_property_option(entity_id, EntityType::Document, def_id, opt)
            .await?;
    }

    // Remove a middle option.
    repo.remove_entity_property_option(entity_id, EntityType::Document, def_id, opt_b)
        .await?;
    assert_eq!(
        read_select_value(&pool, entity_id, def_id).await,
        serde_json::json!({"type": "SelectOption", "value": [opt_a, opt_c]})
    );

    // Removing an absent option is a no-op.
    let absent = macro_uuid::generate_uuid_v7();
    repo.remove_entity_property_option(entity_id, EntityType::Document, def_id, absent)
        .await?;
    assert_eq!(
        read_select_value(&pool, entity_id, def_id).await,
        serde_json::json!({"type": "SelectOption", "value": [opt_a, opt_c]})
    );

    // Removing the rest leaves an empty array, not NULL.
    repo.remove_entity_property_option(entity_id, EntityType::Document, def_id, opt_a)
        .await?;
    repo.remove_entity_property_option(entity_id, EntityType::Document, def_id, opt_c)
        .await?;
    assert_eq!(
        read_select_value(&pool, entity_id, def_id).await,
        serde_json::json!({"type": "SelectOption", "value": []})
    );

    Ok(())
}

/// Extract the sorted option-id strings from a stored SelectOption value.
fn select_option_ids(value: &serde_json::Value) -> Vec<String> {
    let mut ids: Vec<String> = value["value"]
        .as_array()
        .expect("value array")
        .iter()
        .map(|id| id.as_str().expect("uuid string").to_string())
        .collect();
    ids.sort();
    ids
}

fn option_update(
    def_id: Uuid,
    add: Vec<Uuid>,
    remove: Vec<Uuid>,
) -> crate::domain::model::EntityPropertyOptionUpdate {
    crate::domain::model::EntityPropertyOptionUpdate {
        property_definition_id: def_id,
        add_option_ids: add,
        remove_option_ids: remove,
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties_seed"))
)]
async fn bulk_update_options_composes_and_returns_finals(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());
    let def_id = seed_multi_select_definition(&pool, "Bulk Tags Compose").await;
    let entity_id = "entity-bulk-compose";
    let opt_a = macro_uuid::generate_uuid_v7();
    let opt_b = macro_uuid::generate_uuid_v7();
    let opt_c = macro_uuid::generate_uuid_v7();

    // First bulk update attaches the property and adds A and B.
    let first = repo
        .bulk_update_entity_property_options(
            entity_id,
            EntityType::Document,
            &[option_update(def_id, vec![opt_a, opt_b], vec![])],
        )
        .await?;
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].property_definition_id, def_id);
    assert_eq!(first[0].option_ids, vec![opt_a, opt_b]);

    // Second bulk update removes A and adds C, composing with the stored value.
    let second = repo
        .bulk_update_entity_property_options(
            entity_id,
            EntityType::Document,
            &[option_update(def_id, vec![opt_c], vec![opt_a])],
        )
        .await?;
    assert_eq!(second[0].option_ids, vec![opt_b, opt_c]);
    assert_eq!(
        read_select_value(&pool, entity_id, def_id).await,
        serde_json::json!({"type": "SelectOption", "value": [opt_b, opt_c]})
    );

    Ok(())
}

/// Two bulk updates racing on the same row must serialize under the row lock and
/// preserve both changes: a naive read-modify-write would drop one.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties_seed"))
)]
async fn bulk_update_options_concurrent_no_lost_update(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());
    let def_id = seed_multi_select_definition(&pool, "Bulk Tags Concurrent").await;
    let entity_id = "entity-bulk-concurrent";
    let opt_a = macro_uuid::generate_uuid_v7();
    let opt_b = macro_uuid::generate_uuid_v7();

    // Start from {A}.
    repo.bulk_update_entity_property_options(
        entity_id,
        EntityType::Document,
        &[option_update(def_id, vec![opt_a], vec![])],
    )
    .await?;

    // One update removes A while the other adds B, concurrently.
    let remover = {
        let repo = PropertiesPgRepo::new(pool.clone());
        tokio::spawn(async move {
            repo.bulk_update_entity_property_options(
                entity_id,
                EntityType::Document,
                &[option_update(def_id, vec![], vec![opt_a])],
            )
            .await
        })
    };
    let adder = {
        let repo = PropertiesPgRepo::new(pool.clone());
        tokio::spawn(async move {
            repo.bulk_update_entity_property_options(
                entity_id,
                EntityType::Document,
                &[option_update(def_id, vec![opt_b], vec![])],
            )
            .await
        })
    };

    remover.await??;
    adder.await??;

    // Regardless of ordering: A removed, B added. A lost update would leave A.
    assert_eq!(
        select_option_ids(&read_select_value(&pool, entity_id, def_id).await),
        vec![opt_b.to_string()]
    );

    Ok(())
}

/// A failure on any property rolls back the whole batch: an earlier property's
/// change is undone when a later property in the same request fails.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties_seed"))
)]
async fn bulk_update_options_partial_failure_rolls_back(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());
    let def_id = seed_multi_select_definition(&pool, "Bulk Tags Rollback").await;
    let entity_id = "entity-bulk-rollback";
    let existing = macro_uuid::generate_uuid_v7();
    let attempted = macro_uuid::generate_uuid_v7();
    // No such property definition, so writing it violates the foreign key.
    let missing_def_id = macro_uuid::generate_uuid_v7();
    let orphan_option = macro_uuid::generate_uuid_v7();

    // Establish a committed baseline value on the valid property.
    repo.bulk_update_entity_property_options(
        entity_id,
        EntityType::Document,
        &[option_update(def_id, vec![existing], vec![])],
    )
    .await?;

    // The first property would succeed, but the second targets a missing
    // definition and fails the transaction.
    let result = repo
        .bulk_update_entity_property_options(
            entity_id,
            EntityType::Document,
            &[
                option_update(def_id, vec![attempted], vec![]),
                option_update(missing_def_id, vec![orphan_option], vec![]),
            ],
        )
        .await;
    assert!(
        result.is_err(),
        "batch with a missing definition should fail"
    );

    // The valid property is unchanged - the attempted add was rolled back.
    assert_eq!(
        read_select_value(&pool, entity_id, def_id).await,
        serde_json::json!({"type": "SelectOption", "value": [existing]})
    );

    Ok(())
}

/// A removal-only update on a property the entity has no row for is a no-op: it
/// returns an empty selection and must not create an empty `entity_properties`
/// row.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties_seed"))
)]
async fn bulk_update_options_removal_only_on_unattached_is_noop(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());
    let def_id = seed_multi_select_definition(&pool, "Bulk Tags Noop").await;
    let entity_id = "entity-bulk-noop";
    let absent = macro_uuid::generate_uuid_v7();

    let result = repo
        .bulk_update_entity_property_options(
            entity_id,
            EntityType::Document,
            &[option_update(def_id, vec![], vec![absent])],
        )
        .await?;
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].option_ids, Vec::<Uuid>::new());

    let row_count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*) FROM entity_properties
        WHERE entity_id = $1 AND property_definition_id = $2
        "#,
    )
    .bind(entity_id)
    .bind(def_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(row_count, 0, "removal-only update must not create a row");

    Ok(())
}

/// Seeds a select option for the definition and returns its id, so the
/// domain's option validation (which checks `property_options`) accepts it.
async fn seed_option(pool: &Pool<Postgres>, def_id: Uuid, value: &str) -> Uuid {
    PropertiesPgRepo::new(pool.clone())
        .create_property_option(
            def_id,
            0,
            models_properties::service::property_option::PropertyOptionValue::String(
                value.to_string(),
            ),
            None,
        )
        .await
        .expect("seed option")
        .id
}

/// A cross-entity bulk service over the live repo, with no permission,
/// notification, or search-indexer collaborators (unused by the option path).
fn cross_entity_service(
    pool: Pool<Postgres>,
) -> PropertiesServiceImpl<PropertiesPgRepo, MockPermissionService, MockNotificationService> {
    PropertiesServiceImpl::new(
        PropertiesPgRepo::new(pool),
        None::<MockPermissionService>,
        None::<MockNotificationService>,
    )
}

/// An edit receipt for a document entity, minted without an access check.
fn doc_edit_receipt(entity_id: &str) -> EditReceipt {
    let user = MacroUserIdStr::parse_from_str("macro|user1@test.com").expect("valid test user id");
    EditReceipt::dangerously_assert_authenticated_user(
        user,
        entity_id,
        canonical_entity_type(EntityType::Document),
    )
}

/// Two cross-entity bulk updates race on the same two entities, listed in
/// opposite orders: one removes A, the other adds B. The service's consistent
/// per-entity lock ordering avoids deadlock and each entity's row lock avoids a
/// lost update, so both entities end at {B} regardless of interleaving.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties_seed"))
)]
async fn cross_entity_bulk_update_concurrent_no_lost_update(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let def_id = seed_multi_select_definition(&pool, "Cross Entity Concurrent").await;
    let entity_one = "cross-entity-1";
    let entity_two = "cross-entity-2";
    let opt_a = seed_option(&pool, def_id, "A").await;
    let opt_b = seed_option(&pool, def_id, "B").await;

    let service = Arc::new(cross_entity_service(pool.clone()));

    // Both entities start from {A}.
    service
        .bulk_update_entities_property_options(
            &[doc_edit_receipt(entity_one), doc_edit_receipt(entity_two)],
            def_id,
            vec![opt_a],
            vec![],
        )
        .await?;

    let remover = {
        let service = service.clone();
        tokio::spawn(async move {
            service
                .bulk_update_entities_property_options(
                    &[doc_edit_receipt(entity_one), doc_edit_receipt(entity_two)],
                    def_id,
                    vec![],
                    vec![opt_a],
                )
                .await
        })
    };
    let adder = {
        let service = service.clone();
        tokio::spawn(async move {
            service
                .bulk_update_entities_property_options(
                    &[doc_edit_receipt(entity_two), doc_edit_receipt(entity_one)],
                    def_id,
                    vec![opt_b],
                    vec![],
                )
                .await
        })
    };

    remover.await??;
    adder.await??;

    for entity in [entity_one, entity_two] {
        assert_eq!(
            select_option_ids(&read_select_value(&pool, entity, def_id).await),
            vec![opt_b.to_string()],
            "entity {entity} should have A removed and B added"
        );
    }

    Ok(())
}

/// The cross-entity path applies the shared delta and persists it against the
/// live DB for a permitted entity. Per-entity failures can't be provoked here:
/// `entity_properties.entity_id` carries no existence/foreign-key constraint (the
/// entity lives in another database), and the one real FK — `property_definition_id`
/// — is shared, so violating it fails the whole call up front (covered by
/// `bulk_update_options_partial_failure_rolls_back`). Best-effort continuation
/// past a per-entity failure is covered at the service level by
/// `crate::domain::test::test_bulk_update_entities_is_best_effort_on_per_entity_write_failure`.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties_seed"))
)]
async fn cross_entity_bulk_update_applies_and_persists_via_live_db(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let def_id = seed_multi_select_definition(&pool, "Cross Entity Best Effort").await;
    let good = "cross-entity-good";
    let opt = seed_option(&pool, def_id, "opt").await;

    let service = cross_entity_service(pool.clone());
    let outcomes = service
        .bulk_update_entities_property_options(&[doc_edit_receipt(good)], def_id, vec![opt], vec![])
        .await?;

    assert_eq!(outcomes.len(), 1);
    assert!(matches!(
        &outcomes[0],
        crate::domain::model::EntityOptionUpdateOutcome::Applied { option_ids } if *option_ids == vec![opt]
    ));
    assert_eq!(
        select_option_ids(&read_select_value(&pool, good, def_id).await),
        vec![opt.to_string()]
    );

    Ok(())
}
