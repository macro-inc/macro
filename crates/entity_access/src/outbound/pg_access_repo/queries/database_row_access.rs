//! Query for database row access level.

#[cfg(feature = "explain_binary")]
use crate::domain::models::AccessGrant;
use crate::{domain::models::AccessLevel, outbound::pg_access_repo::queries::Viewer};
#[cfg(feature = "explain_binary")]
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// The highest access level a viewer holds on a database row: a row has
/// no grants of its own, so this is its database's access, including Edit
/// through a live form over that database and View through a live form that
/// shares its responses.
#[tracing::instrument(err, skip(pool, viewer))]
pub(crate) async fn get_database_row_access(
    pool: &PgPool,
    row_id: &Uuid,
    viewer: Viewer<'_>,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    if viewer.is_anonymous() {
        return Ok(None);
    }

    let all_level_strings: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        SELECT ea.access_level::text
        FROM database_rows r
        JOIN database_tables t ON t.id = r.table_id
        JOIN database_entities d ON d.database_id = t.database_id
        JOIN entity_access ea ON ea.entity_id = d.database_id
        WHERE r.id = $1
        AND ea.entity_type = 'database'
        AND EXISTS (SELECT FROM entity_access_source_matches(ea.source_id, $2, $3))

        UNION ALL

        SELECT 'edit'
        FROM database_rows r
        JOIN database_tables t ON t.id = r.table_id
        JOIN forms f ON f.database_id = t.database_id
        JOIN database_entities d ON d.database_id = f.database_id
        JOIN entity_access ea ON ea.entity_id = f.id AND ea.entity_type = 'form'
        WHERE r.id = $1
        AND f.trashed_at IS NULL
        AND EXISTS (SELECT FROM entity_access_source_matches(ea.source_id, $2, $3))
        AND ea.access_level IN ('edit', 'owner')

        UNION ALL

        SELECT 'view'
        FROM database_rows r
        JOIN database_tables t ON t.id = r.table_id
        JOIN forms f ON f.database_id = t.database_id
        JOIN database_entities d ON d.database_id = f.database_id
        JOIN entity_access ea ON ea.entity_id = f.id AND ea.entity_type = 'form'
        WHERE r.id = $1
        AND f.trashed_at IS NULL
        AND f.responses_visible
        AND EXISTS (SELECT FROM entity_access_source_matches(ea.source_id, $2, $3))
        AND ea.access_level = 'view'
        "#,
        row_id,
        viewer.id(),
        viewer.scope_team(),
    )
    .fetch_all(pool)
    .await?;

    super::database_access::highest_access_level(&all_level_strings)
}

/// Highest database grant for each requested row, using the caller's shared
/// sources, including Edit through a live form over the row's database and
/// View through a live form that shares its responses.
#[tracing::instrument(err, skip_all, fields(row_count = row_ids.len()))]
pub(crate) async fn get_database_rows_access(
    pool: &PgPool,
    row_ids: &[Uuid],
    viewer: Viewer<'_>,
) -> Result<HashMap<Uuid, AccessLevel>, sqlx::Error> {
    let mut highest: HashMap<Uuid, AccessLevel> = HashMap::new();
    if row_ids.is_empty() || viewer.is_anonymous() {
        return Ok(highest);
    }
    let rows = sqlx::query!(
        r#"
        SELECT r.id AS "id!", ea.access_level AS "access_level!: AccessLevel"
        FROM database_rows r
        JOIN database_tables t ON t.id = r.table_id
        JOIN database_entities d ON d.database_id = t.database_id
        JOIN entity_access ea ON ea.entity_id = d.database_id
        WHERE r.id = ANY($1)
        AND ea.entity_type = 'database'
        AND EXISTS (SELECT FROM entity_access_source_matches(ea.source_id, $2, $3))

        UNION ALL

        SELECT r.id, 'edit'::"AccessLevel"
        FROM database_rows r
        JOIN database_tables t ON t.id = r.table_id
        JOIN forms f ON f.database_id = t.database_id
        JOIN database_entities d ON d.database_id = f.database_id
        JOIN entity_access ea ON ea.entity_id = f.id AND ea.entity_type = 'form'
        WHERE r.id = ANY($1)
        AND f.trashed_at IS NULL
        AND EXISTS (SELECT FROM entity_access_source_matches(ea.source_id, $2, $3))
        AND ea.access_level IN ('edit', 'owner')

        UNION ALL

        SELECT r.id, 'view'::"AccessLevel"
        FROM database_rows r
        JOIN database_tables t ON t.id = r.table_id
        JOIN forms f ON f.database_id = t.database_id
        JOIN database_entities d ON d.database_id = f.database_id
        JOIN entity_access ea ON ea.entity_id = f.id AND ea.entity_type = 'form'
        WHERE r.id = ANY($1)
        AND f.trashed_at IS NULL
        AND f.responses_visible
        AND EXISTS (SELECT FROM entity_access_source_matches(ea.source_id, $2, $3))
        AND ea.access_level = 'view'
        "#,
        row_ids,
        viewer.id(),
        viewer.scope_team(),
    )
    .fetch_all(pool)
    .await?;
    for row in rows {
        highest
            .entry(row.id)
            .and_modify(|level| *level = (*level).max(row.access_level))
            .or_insert(row.access_level);
    }
    Ok(highest)
}

/// The database a row's table belongs to.
#[tracing::instrument(err, skip(pool))]
pub async fn get_database_row_database(
    pool: &PgPool,
    row_id: &Uuid,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        SELECT t.database_id
        FROM database_rows r
        JOIN database_tables t ON t.id = r.table_id
        JOIN database_entities d ON d.database_id = t.database_id
        WHERE r.id = $1
        "#,
        row_id,
    )
    .fetch_optional(pool)
    .await
}

/// List the grants behind a database row's access: those of its database.
#[cfg(feature = "explain_binary")]
#[tracing::instrument(err, skip(pool, user_id))]
pub async fn explain_database_row_access(
    pool: &PgPool,
    row_id: &Uuid,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Vec<AccessGrant>, sqlx::Error> {
    let Some(database_id) = get_database_row_database(pool, row_id).await? else {
        return Ok(vec![]);
    };
    super::database_access::explain_database_access(pool, &database_id, user_id).await
}
