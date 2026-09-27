use std::collections::{HashMap, HashSet};

use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use super::{AdapterError, map_sqlx};
use crate::domain::models::{AssignTaskStatus, AssignTasksResult, InitiativeError, InitiativeId};

pub(super) async fn assign_tasks(
    pool: &PgPool,
    id: InitiativeId,
    task_ids: Vec<String>,
) -> Result<Vec<AssignTasksResult>, InitiativeError> {
    if task_ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut tx = pool
        .begin()
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)?;
    let initiative_id = id.as_uuid();
    lock_initiative(&mut tx, initiative_id).await?;

    sqlx::query!(
        r#"
        SELECT id
        FROM "Document"
        WHERE id = ANY($1)
        ORDER BY id
        FOR UPDATE
        "#,
        &task_ids,
    )
    .fetch_all(tx.as_mut())
    .await
    .map_err(AdapterError::Sqlx)
    .map_err(map_sqlx)?;

    let prior_rows = sqlx::query!(
        r#"
        SELECT task_id, initiative_id
        FROM task_initiative
        WHERE task_id = ANY($1)
        FOR UPDATE
        "#,
        &task_ids,
    )
    .fetch_all(tx.as_mut())
    .await
    .map_err(AdapterError::Sqlx)
    .map_err(map_sqlx)?;

    let prior: HashMap<String, Uuid> = prior_rows
        .into_iter()
        .map(|row| (row.task_id, row.initiative_id))
        .collect();

    let returned_rows = sqlx::query!(
        r#"
        INSERT INTO task_initiative (task_id, initiative_id)
        SELECT dst.document_id, $1
        FROM UNNEST($2::text[]) AS t(task_id)
        JOIN document_sub_type dst
            ON dst.document_id = t.task_id AND dst.sub_type = 'task'
        ON CONFLICT (task_id) DO UPDATE
        SET initiative_id = EXCLUDED.initiative_id, created_at = now()
        RETURNING task_id
        "#,
        initiative_id,
        &task_ids,
    )
    .fetch_all(tx.as_mut())
    .await
    .map_err(AdapterError::Sqlx)
    .map_err(map_sqlx)?;

    let returned: HashSet<String> = returned_rows.into_iter().map(|row| row.task_id).collect();

    sqlx::query!(
        r#"
        UPDATE initiative
        SET updated_at = now()
        WHERE id = $1
        "#,
        initiative_id,
    )
    .execute(tx.as_mut())
    .await
    .map_err(AdapterError::Sqlx)
    .map_err(map_sqlx)?;

    tx.commit()
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)?;

    Ok(task_ids
        .into_iter()
        .map(|task_id| AssignTasksResult {
            status: assign_status_for(&task_id, &prior, &returned, initiative_id),
            task_id,
        })
        .collect())
}

pub(super) async fn unassign_task(
    pool: &PgPool,
    id: InitiativeId,
    task_id: &str,
) -> Result<(), InitiativeError> {
    let mut tx = pool
        .begin()
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)?;
    let initiative_id = id.as_uuid();
    lock_initiative(&mut tx, initiative_id).await?;
    let result = sqlx::query!(
        r#"
        DELETE FROM task_initiative
        WHERE task_id = $1 AND initiative_id = $2
        "#,
        task_id,
        initiative_id,
    )
    .execute(tx.as_mut())
    .await
    .map_err(AdapterError::Sqlx)
    .map_err(map_sqlx)?;

    if result.rows_affected() == 0 {
        return Err(InitiativeError::NotFound);
    }

    sqlx::query!(
        r#"
        UPDATE initiative
        SET updated_at = now()
        WHERE id = $1
        "#,
        initiative_id,
    )
    .execute(tx.as_mut())
    .await
    .map_err(AdapterError::Sqlx)
    .map_err(map_sqlx)?;

    tx.commit()
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)?;
    Ok(())
}

pub(super) async fn clear_task(pool: &PgPool, task_id: &str) -> Result<(), InitiativeError> {
    sqlx::query_scalar!(
        r#"
        WITH removed AS (
            DELETE FROM task_initiative
            WHERE task_id = $1
            RETURNING initiative_id
        )
        UPDATE initiative
        SET updated_at = now()
        WHERE id IN (SELECT initiative_id FROM removed)
        RETURNING id
        "#,
        task_id,
    )
    .fetch_optional(pool)
    .await
    .map_err(AdapterError::Sqlx)
    .map_err(map_sqlx)?;
    Ok(())
}

async fn lock_initiative(
    tx: &mut Transaction<'_, Postgres>,
    initiative_id: Uuid,
) -> Result<(), InitiativeError> {
    let locked = sqlx::query_scalar!(
        r#"
        SELECT id
        FROM initiative
        WHERE id = $1
        FOR UPDATE
        "#,
        initiative_id,
    )
    .fetch_optional(tx.as_mut())
    .await
    .map_err(AdapterError::Sqlx)
    .map_err(map_sqlx)?;
    if locked.is_none() {
        return Err(InitiativeError::NotFound);
    }
    Ok(())
}

fn assign_status_for(
    task_id: &str,
    prior: &HashMap<String, Uuid>,
    returned: &HashSet<String>,
    this_initiative: Uuid,
) -> AssignTaskStatus {
    if !returned.contains(task_id) {
        return AssignTaskStatus::NotATask;
    }
    match prior.get(task_id) {
        Some(owner) if *owner != this_initiative => AssignTaskStatus::Moved,
        _ => AssignTaskStatus::Assigned,
    }
}
