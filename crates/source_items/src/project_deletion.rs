//! Capture the projection keys affected by PostgreSQL project cascades.

use sqlx::PgConnection;
use std::collections::BTreeSet;

/// Lock the recursively deleted projects and capture their inherited-grant
/// targets before deleting them. Call [`crate::sync_rows`] with the returned
/// keys after deletion, in this same transaction.
///
/// FOR UPDATE blocks new child/grant foreign-key references. Repeat discovery
/// after locking newly found children to include inserts that committed before
/// their parent was locked. Supersets caused by a concurrent move are harmless.
pub async fn capture(
    connection: &mut PgConnection,
    project_ids: &[String],
) -> Result<Vec<(String, String)>, sqlx::Error> {
    let mut locked = BTreeSet::new();
    loop {
        let ids = sqlx::query_scalar!(
            r#"WITH RECURSIVE projects AS (
                SELECT id FROM "Project" WHERE id = ANY($1)
                UNION
                SELECT p.id FROM "Project" p JOIN projects parent ON p."parentId" = parent.id
            ) SELECT id AS "id!" FROM projects ORDER BY id"#,
            project_ids,
        )
        .fetch_all(&mut *connection)
        .await?;
        let pending = ids
            .into_iter()
            .filter(|id| !locked.contains(id))
            .collect::<Vec<_>>();
        if pending.is_empty() {
            break;
        }
        let rows = sqlx::query_scalar!(
            r#"SELECT id FROM "Project" WHERE id = ANY($1) ORDER BY id FOR UPDATE"#,
            &pending,
        )
        .fetch_all(&mut *connection)
        .await?;
        locked.extend(rows);
    }
    let ids = locked.into_iter().collect::<Vec<_>>();
    let mut affected = sqlx::query!(
        r#"SELECT DISTINCT entity_type, entity_id::text AS "entity_id!"
           FROM entity_access WHERE granted_from_project_id = ANY($1)"#,
        &ids,
    )
    .map(|row| (row.entity_type, row.entity_id))
    .fetch_all(connection)
    .await?;
    affected.extend(ids.into_iter().map(|id| ("project".to_owned(), id)));
    Ok(affected)
}
