//! Helper functions for bidirectional task parent/subtask linking.

use anyhow::Context;
use models_properties::EntityReference;
use models_properties::EntityType;
use models_properties::service::property_value::PropertyValue;
use sqlx::{PgConnection, Pool, Postgres};
use system_properties::SystemPropertyKey;
use uuid::Uuid;

// ============================================================================
// Main linking functions
// ============================================================================

/// Link or unlink a task's parent (for Parent Task property).
pub async fn link_parent_task(
    pool: &Pool<Postgres>,
    task_id: Uuid,
    parent_task_id: Option<Uuid>,
) -> anyhow::Result<()> {
    let mut tx = pool.begin().await.context("failed to begin transaction")?;

    // 1. Get old parent
    let old_parent = get_task_parent(&mut tx, task_id).await?;
    tracing::debug!(old_parent = ?old_parent, "fetched current parent");

    // 2. Remove from old parent if changed
    if let Some(old_parent_id) = old_parent {
        if Some(old_parent_id) != parent_task_id {
            remove_from_parent_subtasks(&mut tx, old_parent_id, task_id).await?;
            tracing::debug!(old_parent = %old_parent_id, "removed task from old parent's Subtasks");
        }
    }

    // 3. Set new parent
    set_task_parent(&mut tx, task_id, parent_task_id).await?;

    // 4. Add to new parent's subtasks
    if let Some(parent_id) = parent_task_id {
        add_to_parent_subtasks(&mut tx, parent_id, task_id).await?;
        tracing::debug!("added task to parent's Subtasks");
    }

    tx.commit().await.context("failed to commit transaction")?;
    tracing::info!("successfully linked parent task");
    Ok(())
}

/// Set a task's subtasks (for Subtasks property).
pub async fn link_subtasks(
    pool: &Pool<Postgres>,
    task_id: Uuid,
    subtask_ids: Vec<Uuid>,
) -> anyhow::Result<()> {
    let mut tx = pool.begin().await.context("failed to begin transaction")?;

    // 1. Get current subtasks & compute diff
    let current_subtasks = get_task_subtasks(&mut tx, task_id).await?;

    let added: Vec<Uuid> = subtask_ids
        .iter()
        .copied()
        .filter(|id| !current_subtasks.contains(id))
        .collect();
    let removed: Vec<Uuid> = current_subtasks
        .iter()
        .copied()
        .filter(|id| !subtask_ids.contains(id))
        .collect();

    tracing::debug!(
        current = ?current_subtasks,
        added = ?added,
        removed = ?removed,
        "computed subtasks diff"
    );

    // 2. Set task's subtasks to new list
    set_task_subtasks(&mut tx, task_id, subtask_ids).await?;

    // 3. For added subtasks: remove from old parent, set new parent
    for subtask_id in &added {
        if let Some(old_parent_id) = get_task_parent(&mut tx, *subtask_id).await? {
            if old_parent_id != task_id {
                remove_from_parent_subtasks(&mut tx, old_parent_id, *subtask_id).await?;
                tracing::debug!(
                    subtask = %subtask_id,
                    old_parent = %old_parent_id,
                    "removed subtask from old parent's Subtasks"
                );
            }
        }
        set_task_parent(&mut tx, *subtask_id, Some(task_id)).await?;
    }

    // 4. For removed subtasks: clear their parent
    for subtask_id in &removed {
        set_task_parent(&mut tx, *subtask_id, None).await?;
    }

    tx.commit().await.context("failed to commit transaction")?;
    tracing::info!(
        added_count = added.len(),
        removed_count = removed.len(),
        "successfully linked subtasks"
    );
    Ok(())
}

// ============================================================================
// Helper functions
// ============================================================================

/// Get a task's current parent task ID.
async fn get_task_parent(tx: &mut PgConnection, task_id: Uuid) -> anyhow::Result<Option<Uuid>> {
    let parent_task_prop_id = SystemPropertyKey::PARENT_TASK_UUID;
    let task_id_str = task_id.to_string();

    let parent_str: Option<Option<String>> = sqlx::query_scalar!(
        r#"
        SELECT values->'value'->0->>'entity_id' as "parent_id"
        FROM entity_properties
        WHERE entity_id = $1
          AND entity_type = 'TASK'
          AND property_definition_id = $2
          AND values IS NOT NULL
        "#,
        task_id_str,
        parent_task_prop_id
    )
    .fetch_optional(&mut *tx)
    .await
    .context("failed to get task's parent")?;

    Ok(parent_str.flatten().and_then(|s| Uuid::parse_str(&s).ok()))
}

/// Get a task's current subtask IDs.
async fn get_task_subtasks(tx: &mut PgConnection, task_id: Uuid) -> anyhow::Result<Vec<Uuid>> {
    let subtasks_prop_id = SystemPropertyKey::SUBTASKS_UUID;
    let task_id_str = task_id.to_string();

    let subtask_strs: Vec<String> = sqlx::query_scalar!(
        r#"
        SELECT elem->>'entity_id' as "subtask_id!"
        FROM entity_properties,
             jsonb_array_elements(values->'value') elem
        WHERE entity_id = $1
          AND entity_type = 'TASK'
          AND property_definition_id = $2
          AND values IS NOT NULL
        "#,
        task_id_str,
        subtasks_prop_id
    )
    .fetch_all(&mut *tx)
    .await
    .context("failed to get task's subtasks")?;

    Ok(subtask_strs
        .into_iter()
        .filter_map(|s| Uuid::parse_str(&s).ok())
        .collect())
}

/// Remove a task from a parent's subtasks array.
async fn remove_from_parent_subtasks(
    tx: &mut PgConnection,
    parent_id: Uuid,
    task_id: Uuid,
) -> anyhow::Result<()> {
    let current = get_task_subtasks(&mut *tx, parent_id).await?;
    let updated: Vec<Uuid> = current.into_iter().filter(|id| *id != task_id).collect();
    set_task_subtasks(&mut *tx, parent_id, updated).await
}

/// Set a task's parent task property.
async fn set_task_parent(
    tx: &mut PgConnection,
    task_id: Uuid,
    parent_task_id: Option<Uuid>,
) -> anyhow::Result<()> {
    let parent_task_prop_id = SystemPropertyKey::PARENT_TASK_UUID;
    let task_id_str = task_id.to_string();

    let parent_value = match parent_task_id {
        Some(parent_id) => {
            let entity_ref = EntityReference::new(parent_id.to_string(), EntityType::Task);
            serde_json::to_value(PropertyValue::EntityRef(vec![entity_ref]))
                .context("failed to serialize parent task value")?
        }
        None => serde_json::Value::Null,
    };

    sqlx::query!(
        r#"
        UPDATE entity_properties
        SET values = $4, updated_at = NOW()
        WHERE entity_id = $1
          AND entity_type = $2
          AND property_definition_id = $3
        "#,
        task_id_str,
        EntityType::Task as EntityType,
        parent_task_prop_id,
        parent_value
    )
    .execute(&mut *tx)
    .await
    .context("failed to set task's parent")?;

    Ok(())
}

/// Add a task to a parent's subtasks array (if not already present).
async fn add_to_parent_subtasks(
    tx: &mut PgConnection,
    parent_id: Uuid,
    task_id: Uuid,
) -> anyhow::Result<()> {
    let current = get_task_subtasks(&mut *tx, parent_id).await?;

    if !current.contains(&task_id) {
        let mut updated = current;
        updated.push(task_id);
        set_task_subtasks(&mut *tx, parent_id, updated).await?;
    }

    Ok(())
}

/// Set a task's subtasks property to a new list.
async fn set_task_subtasks(
    tx: &mut PgConnection,
    task_id: Uuid,
    subtask_ids: Vec<Uuid>,
) -> anyhow::Result<()> {
    let subtasks_prop_id = SystemPropertyKey::SUBTASKS_UUID;
    let task_id_str = task_id.to_string();

    let subtasks_value = if subtask_ids.is_empty() {
        serde_json::Value::Null
    } else {
        let refs: Vec<EntityReference> = subtask_ids
            .iter()
            .map(|id| EntityReference::new(id.to_string(), EntityType::Task))
            .collect();
        serde_json::to_value(PropertyValue::EntityRef(refs))
            .context("failed to serialize subtasks value")?
    };

    sqlx::query!(
        r#"
        UPDATE entity_properties
        SET values = $4, updated_at = NOW()
        WHERE entity_id = $1
          AND entity_type = $2
          AND property_definition_id = $3
        "#,
        task_id_str,
        EntityType::Task as EntityType,
        subtasks_prop_id,
        subtasks_value
    )
    .execute(&mut *tx)
    .await
    .context("failed to set task's subtasks")?;

    Ok(())
}
