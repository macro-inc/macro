//! Atomic replacement of directed task dependencies.

#[cfg(test)]
mod test;

use std::collections::{HashMap, HashSet};

use models_properties::EntityType;
use models_properties::service::entity_property::EntityProperty;
use sqlx::{PgConnection, Pool, Postgres};
use system_properties::SystemPropertyKey;
use uuid::Uuid;

use crate::domain::ports::TaskDependencyLinkOutcome;

/// Read the endpoints of a task relationship from the indexed edge table.
pub async fn targets(
    connection: &mut PgConnection,
    task_id: Uuid,
    property_definition_id: Uuid,
) -> anyhow::Result<Vec<Uuid>> {
    if property_definition_id == SystemPropertyKey::DEPENDS_ON_UUID {
        Ok(sqlx::query_scalar!(
            "SELECT blocker_task_id FROM task_dependency_edges WHERE dependent_task_id = $1",
            task_id
        )
        .fetch_all(connection)
        .await?)
    } else if property_definition_id == SystemPropertyKey::BLOCKING_UUID {
        Ok(sqlx::query_scalar!(
            "SELECT dependent_task_id FROM task_dependency_edges WHERE blocker_task_id = $1",
            task_id
        )
        .fetch_all(connection)
        .await?)
    } else {
        anyhow::bail!("invalid task dependency property")
    }
}

/// Replace one direction after checking the expected edge snapshot. Shared
/// endpoint locks serialize reciprocal writes and direct-cycle admission without
/// serializing unrelated tasks.
#[tracing::instrument(skip_all, fields(task_id = %task_id, property_definition_id = %property_definition_id, endpoint_count = desired.len() as i64, outcome = tracing::field::Empty), err)]
pub async fn link(
    pool: &Pool<Postgres>,
    task_id: Uuid,
    property_definition_id: Uuid,
    expected: Vec<Uuid>,
    desired: Vec<Uuid>,
) -> anyhow::Result<TaskDependencyLinkOutcome> {
    // Database timeouts bound statements without abandoning COMMIT and losing
    // receipts for an edit that the server has already committed.
    let result = link_transaction(pool, task_id, property_definition_id, expected, desired).await;
    let outcome = match &result {
        Ok(TaskDependencyLinkOutcome::Updated(..)) => "Updated",
        Ok(TaskDependencyLinkOutcome::Stale) => "Stale",
        Ok(TaskDependencyLinkOutcome::Cycle) => "Cycle",
        Ok(TaskDependencyLinkOutcome::MissingTask) => "MissingTask",
        Err(_) => "Error",
    };
    tracing::Span::current().record("outcome", outcome);
    result
}

/// Keep endpoint locks and all edge work within one database transaction.
async fn link_transaction(
    pool: &Pool<Postgres>,
    task_id: Uuid,
    property_definition_id: Uuid,
    expected: Vec<Uuid>,
    desired: Vec<Uuid>,
) -> anyhow::Result<TaskDependencyLinkOutcome> {
    if desired.len() > 1000 {
        anyhow::bail!("At most 1000 task relationships can be edited at once");
    }
    let forward = property_definition_id == SystemPropertyKey::DEPENDS_ON_UUID;
    if !forward && property_definition_id != SystemPropertyKey::BLOCKING_UUID {
        anyhow::bail!("invalid task dependency property")
    }

    let desired: HashSet<Uuid> = desired.into_iter().collect();
    if desired.contains(&task_id) {
        return Ok(TaskDependencyLinkOutcome::Cycle);
    }

    let mut tx = pool.begin().await?;
    sqlx::query!("SET LOCAL statement_timeout = '10s'")
        .execute(&mut *tx)
        .await?;
    let endpoints = std::iter::once(task_id)
        .chain(expected.iter().copied())
        .chain(desired.iter().copied())
        .collect::<Vec<_>>();
    lock_endpoints(&mut tx, &endpoints).await?;

    let current: HashSet<Uuid> = targets(&mut tx, task_id, property_definition_id)
        .await?
        .into_iter()
        .collect();
    if current != expected.into_iter().collect() {
        return Ok(TaskDependencyLinkOutcome::Stale);
    }

    let task_id_str = task_id.to_string();
    // Blocking was added after many tasks were created. Attach missing system
    // assignments only to entities already known in the TASK namespace.
    sqlx::query!(
        "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id)
         SELECT $1, $2, 'TASK', $3 WHERE EXISTS (
             SELECT 1 FROM entity_properties WHERE entity_id = $2 AND entity_type = 'TASK')
         ON CONFLICT (entity_id, entity_type, property_definition_id) DO NOTHING",
        Uuid::now_v7(),
        task_id_str,
        property_definition_id
    )
    .execute(&mut *tx)
    .await?;
    let assignment = sqlx::query_as!(
        EntityProperty,
        r#"SELECT id, entity_id, entity_type as "entity_type: EntityType",
                  property_definition_id, created_at, updated_at
           FROM entity_properties WHERE entity_id = $1 AND entity_type = 'TASK'
             AND property_definition_id = $2"#,
        task_id_str,
        property_definition_id
    )
    .fetch_optional(&mut *tx)
    .await?;
    let Some(assignment) = assignment else {
        return Ok(TaskDependencyLinkOutcome::MissingTask);
    };

    let inverse_property_id = if forward {
        SystemPropertyKey::BLOCKING_UUID
    } else {
        SystemPropertyKey::DEPENDS_ON_UUID
    };
    let desired_ids: Vec<String> = desired.iter().map(ToString::to_string).collect();
    let inverse_ids: Vec<Uuid> = desired.iter().map(|_| Uuid::now_v7()).collect();
    sqlx::query!(
        "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id)
         SELECT requested.assignment_id, requested.entity_id, 'TASK', $2
         FROM unnest($1::text[], $3::uuid[]) requested(entity_id, assignment_id)
         WHERE EXISTS (SELECT 1 FROM entity_properties existing
             WHERE existing.entity_id = requested.entity_id AND existing.entity_type = 'TASK')
         ON CONFLICT (entity_id, entity_type, property_definition_id) DO NOTHING",
        &desired_ids,
        inverse_property_id,
        &inverse_ids
    )
    .execute(&mut *tx)
    .await?;
    let touched_ids = current
        .union(&desired)
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let endpoint_properties = sqlx::query!(
        "SELECT target.id, target.entity_id, target.values FROM unnest($1::text[]) requested(entity_id)
         CROSS JOIN LATERAL (SELECT id, entity_id, values FROM entity_properties
             WHERE entity_id = requested.entity_id AND entity_type = 'TASK' AND property_definition_id = $2 LIMIT 1) target",
        &touched_ids,
        inverse_property_id
    )
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .map(|row| (row.entity_id.clone(), row))
    .collect::<HashMap<_, _>>();
    if desired_ids
        .iter()
        .any(|id| !endpoint_properties.contains_key(id))
    {
        return Ok(TaskDependencyLinkOutcome::MissingTask);
    }

    let removed: Vec<Uuid> = current.difference(&desired).copied().collect();
    let added: Vec<Uuid> = desired.difference(&current).copied().collect();
    // Existing oversized lists remain removable. Only additions consume capacity
    // on the inverse endpoint, and endpoint locks make this check atomic.
    let inverse_full = if forward {
        sqlx::query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM unnest($1::uuid[]) endpoint(id)
                WHERE (SELECT count(*) FROM (
                    SELECT 1 FROM task_dependency_edges WHERE blocker_task_id = endpoint.id LIMIT 1000
                ) edges) >= 1000) AS "full!""#,
            &added
        )
        .fetch_one(&mut *tx)
        .await?
    } else {
        sqlx::query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM unnest($1::uuid[]) endpoint(id)
                WHERE (SELECT count(*) FROM (
                    SELECT 1 FROM task_dependency_edges WHERE dependent_task_id = endpoint.id LIMIT 1000
                ) edges) >= 1000) AS "full!""#,
            &added
        )
        .fetch_one(&mut *tx)
        .await?
    };
    if inverse_full {
        anyhow::bail!("At most 1000 task relationships are allowed per property");
    }
    if forward {
        sqlx::query!("DELETE FROM task_dependency_edges WHERE dependent_task_id = $1 AND blocker_task_id = ANY($2)", task_id, &removed).execute(&mut *tx).await?;
    } else {
        sqlx::query!("DELETE FROM task_dependency_edges WHERE blocker_task_id = $1 AND dependent_task_id = ANY($2)", task_id, &removed).execute(&mut *tx).await?;
    }

    let additions: Vec<(Uuid, Uuid)> = added
        .iter()
        .map(|id| {
            if forward {
                (task_id, *id)
            } else {
                (*id, task_id)
            }
        })
        .collect();
    let dependent_ids: Vec<Uuid> = additions.iter().map(|(dependent, _)| *dependent).collect();
    let blocker_ids: Vec<Uuid> = additions.iter().map(|(_, blocker)| *blocker).collect();
    if !additions.is_empty() {
        let cycle = sqlx::query_scalar!(
            r#"SELECT EXISTS (
                SELECT 1 FROM unnest($1::uuid[], $2::uuid[]) input(dependent, blocker)
                JOIN task_dependency_edges edge
                  ON edge.dependent_task_id = input.blocker
                 AND edge.blocker_task_id = input.dependent
            ) AS "cycle!""#,
            &dependent_ids,
            &blocker_ids
        )
        .fetch_one(&mut *tx)
        .await?;
        if cycle {
            return Ok(TaskDependencyLinkOutcome::Cycle);
        }
    }

    let mut dependent_properties = Vec::with_capacity(additions.len());
    let mut blocking_properties = Vec::with_capacity(additions.len());
    for (dependent, blocker) in &additions {
        let endpoint = if forward { blocker } else { dependent };
        let Some(inverse_row) = endpoint_properties.get(&endpoint.to_string()) else {
            return Ok(TaskDependencyLinkOutcome::MissingTask);
        };
        dependent_properties.push(if forward {
            assignment.id
        } else {
            inverse_row.id
        });
        blocking_properties.push(if forward {
            inverse_row.id
        } else {
            assignment.id
        });
    }
    sqlx::query!("INSERT INTO task_dependency_edges (dependent_task_id, blocker_task_id, dependent_property_id, blocking_property_id)
        SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[])
        ON CONFLICT (dependent_task_id, blocker_task_id) DO NOTHING",
        &dependent_ids, &blocker_ids, &dependent_properties, &blocking_properties
    ).execute(&mut *tx).await?;

    let property = sqlx::query_as!(
        EntityProperty,
        r#"SELECT id, entity_id, entity_type as "entity_type: EntityType",
                  property_definition_id, created_at, updated_at
           FROM entity_properties WHERE id = $1"#,
        assignment.id
    )
    .fetch_one(&mut *tx)
    .await?;
    let inverse_ids = current
        .symmetric_difference(&desired)
        .filter_map(|id| endpoint_properties.get(&id.to_string()).map(|row| row.id))
        .collect::<Vec<_>>();
    let reciprocal_rows = sqlx::query!(r#"SELECT id, entity_id, entity_type AS "entity_type: EntityType",
        property_definition_id, created_at, updated_at, values FROM entity_properties WHERE id = ANY($1)"#, &inverse_ids)
        .fetch_all(&mut *tx).await?;
    let mut reciprocal = Vec::with_capacity(reciprocal_rows.len());
    for row in reciprocal_rows {
        let before = endpoint_properties
            .get(&row.entity_id)
            .and_then(|row| row.values.clone());
        // Preserve the empty baseline for new assignments, but discard malformed
        // legacy metadata instead of rolling back a valid graph repair.
        let previous_value = super::entity_property_queries::decode_stored_property_value(before)
            .ok()
            .map(|value| {
                value.unwrap_or_else(|| {
                    models_properties::service::property_value::PropertyValue::EntityRef(vec![])
                })
            });
        let value = super::entity_property_queries::decode_stored_property_value(row.values)?;
        reciprocal.push(crate::domain::model::EntityPropertyMutationSnapshot {
            property: EntityProperty {
                id: row.id,
                entity_id: row.entity_id,
                entity_type: row.entity_type,
                property_definition_id: row.property_definition_id,
                created_at: row.created_at,
                updated_at: row.updated_at,
            },
            value,
            previous_value,
        });
    }
    tx.commit().await?;
    Ok(TaskDependencyLinkOutcome::Updated(property, reciprocal))
}

/// Acquire deduplicated endpoint locks in PostgreSQL signed-key order.
pub(super) async fn lock_endpoints(
    connection: &mut PgConnection,
    endpoints: &[Uuid],
) -> anyhow::Result<()> {
    sqlx::query!(
        "SELECT lock_task_dependency_endpoints($1::uuid[]) IS NULL AS locked",
        endpoints
    )
    .fetch_one(connection)
    .await?;
    Ok(())
}

/// Discover all neighbors without truncating historical oversized relationships.
pub(super) async fn neighbors(
    connection: &mut PgConnection,
    task_id: Uuid,
) -> anyhow::Result<Vec<Uuid>> {
    Ok(sqlx::query_scalar!(
        r#"SELECT blocker_task_id AS "blocker_task_id!" FROM task_dependency_edges WHERE dependent_task_id = $1
         UNION SELECT dependent_task_id FROM task_dependency_edges WHERE blocker_task_id = $1
         ORDER BY 1"#,
        task_id,
    )
    .fetch_all(connection)
    .await?)
}

/// Fence cleanup discovery, including roots whose first edge has not arrived yet.
pub(super) async fn lock_cleanup_endpoints(
    connection: &mut PgConnection,
    task_id: Uuid,
    discovered: &[Uuid],
) -> anyhow::Result<()> {
    let endpoints = std::iter::once(task_id)
        .chain(discovered.iter().copied())
        .collect::<Vec<_>>();
    lock_endpoints(connection, &endpoints).await?;
    if discovered != neighbors(connection, task_id).await? {
        return Err(anyhow::Error::new(
            crate::domain::error::PropertiesErr::DependencyContended,
        ));
    }
    Ok(())
}
