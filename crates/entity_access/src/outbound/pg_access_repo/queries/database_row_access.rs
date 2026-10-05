//! Query for database row access level.

#[cfg(feature = "explain_binary")]
use crate::{
    domain::models::AccessGrant, outbound::pg_access_repo::queries::list_entity_access_grants,
};
use crate::{domain::models::AccessLevel, outbound::pg_access_repo::queries::SourceIds};
#[cfg(feature = "explain_binary")]
use model_entity::EntityType;
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// The highest access level `source_ids` hold on a database row: a row has
/// no grants of its own, so this is its database's access.
#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn get_database_row_access(
    pool: &PgPool,
    row_id: &Uuid,
    source_ids: &SourceIds,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    if source_ids.0.is_empty() {
        return Ok(None);
    }

    let all_level_strings: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        SELECT ea.access_level::text
        FROM database_rows r
        JOIN database_tables t ON t.id = r.table_id
        JOIN database_entity d ON d.database_id = t.database_id
        JOIN entity_access ea ON ea.entity_id = d.database_id
        WHERE r.id = $1
        AND ea.entity_type = 'database'
        AND ea.source_id = ANY($2)
        "#,
        row_id,
        &source_ids.0,
    )
    .fetch_all(pool)
    .await?;

    super::database_access::highest_access_level(&all_level_strings)
}

/// Highest database grant for each requested row, using the caller's shared sources.
#[tracing::instrument(err, skip_all, fields(row_count = row_ids.len()))]
pub async fn get_database_rows_access(
    pool: &PgPool,
    row_ids: &[Uuid],
    source_ids: &SourceIds,
) -> Result<HashMap<Uuid, AccessLevel>, sqlx::Error> {
    let mut highest: HashMap<Uuid, AccessLevel> = HashMap::new();
    if row_ids.is_empty() || source_ids.0.is_empty() {
        return Ok(highest);
    }
    let rows = sqlx::query!(
        r#"
        SELECT r.id, ea.access_level AS "access_level!: AccessLevel"
        FROM database_rows r
        JOIN database_tables t ON t.id = r.table_id
        JOIN database_entity d ON d.database_id = t.database_id
        JOIN entity_access ea ON ea.entity_id = d.database_id
        WHERE r.id = ANY($1)
        AND ea.entity_type = 'database'
        AND ea.source_id = ANY($2)
        "#,
        row_ids,
        &source_ids.0,
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
        JOIN database_entity d ON d.database_id = t.database_id
        WHERE r.id = $1
        "#,
        row_id,
    )
    .fetch_optional(pool)
    .await
}

/// List the grants behind a database row's access: those of its database.
#[cfg(feature = "explain_binary")]
#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn explain_database_row_access(
    pool: &PgPool,
    row_id: &Uuid,
    source_ids: &SourceIds,
) -> Result<Vec<AccessGrant>, sqlx::Error> {
    let Some(database_id) = get_database_row_database(pool, row_id).await? else {
        return Ok(vec![]);
    };
    list_entity_access_grants(pool, &database_id, EntityType::Database, source_ids).await
}
