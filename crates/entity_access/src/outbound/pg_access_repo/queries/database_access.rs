//! Query for database access level.

#[cfg(feature = "explain_binary")]
use crate::{
    domain::models::AccessGrant, outbound::pg_access_repo::queries::list_entity_access_grants,
};
use crate::{domain::models::AccessLevel, outbound::pg_access_repo::queries::SourceIds};
#[cfg(feature = "explain_binary")]
use model_entity::EntityType;
use sqlx::PgPool;
use std::collections::BTreeMap;
use std::str::FromStr;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// The highest access level `source_ids` hold on a database: its own grants,
/// and Edit through edit or owner on any live form over it, so form editors
/// can read and change their responses. View on a form grants nothing here. A
/// database has no `SharePermission`, so there is no public-sharing arm.
#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn get_database_access(
    pool: &PgPool,
    database_id: &uuid::Uuid,
    source_ids: &SourceIds,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    if source_ids.0.is_empty() {
        return Ok(None);
    }

    let all_level_strings: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        SELECT access_level::text
        FROM entity_access
        JOIN database_entities d ON d.database_id = entity_access.entity_id
        WHERE entity_id = $1
        AND entity_type = 'database'
        AND source_id = ANY($2)

        UNION ALL

        SELECT 'edit'
        FROM forms f
        JOIN entity_access ea ON ea.entity_id = f.id AND ea.entity_type = 'form'
        WHERE f.database_id = $1
        AND f.trashed_at IS NULL
        AND ea.source_id = ANY($2)
        AND ea.access_level IN ('edit', 'owner')
        "#,
        database_id,
        &source_ids.0,
    )
    .fetch_all(pool)
    .await?;

    highest_access_level(&all_level_strings)
}

/// The highest of a set of `access_level::text` values; an unknown level is a decode error.
pub(super) fn highest_access_level(
    levels: &[Option<String>],
) -> Result<Option<AccessLevel>, sqlx::Error> {
    levels
        .iter()
        .flatten()
        .map(|level| {
            AccessLevel::from_str(level).map_err(|error| sqlx::Error::Decode(error.into()))
        })
        .try_fold(None, |highest: Option<AccessLevel>, level| {
            Ok(highest.max(Some(level?)))
        })
}

/// The highest access level a user has on every database their source ids
/// reach, directly or as Edit through a live form they edit, ordered by
/// database id. Trash is the databases domain's concern: a trashed database's
/// grants are still listed.
#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn list_database_access(
    pool: &PgPool,
    source_ids: &SourceIds,
) -> Result<Vec<(Uuid, AccessLevel)>, sqlx::Error> {
    if source_ids.0.is_empty() {
        return Ok(Vec::new());
    }

    let rows = sqlx::query!(
        r#"
        SELECT entity_id AS "entity_id!", access_level AS "access_level!: AccessLevel"
        FROM entity_access
        JOIN database_entities d ON d.database_id = entity_access.entity_id
        WHERE entity_type = 'database'
        AND source_id = ANY($1)

        UNION ALL

        SELECT f.database_id, 'edit'::"AccessLevel"
        FROM entity_access ea
        JOIN forms f ON f.id = ea.entity_id
        WHERE ea.entity_type = 'form'
        AND ea.source_id = ANY($1)
        AND ea.access_level IN ('edit', 'owner')
        AND f.trashed_at IS NULL
        "#,
        &source_ids.0,
    )
    .fetch_all(pool)
    .await?;

    let mut highest: BTreeMap<Uuid, AccessLevel> = BTreeMap::new();
    for row in rows {
        highest
            .entry(row.entity_id)
            .and_modify(|level| *level = (*level).max(row.access_level))
            .or_insert(row.access_level);
    }
    Ok(highest.into_iter().collect())
}

/// List the grants behind a database's access: its own `entity_access` rows,
/// then a [`AccessGrant::ViaForm`] for each live form over it the caller
/// edits, in form id order.
#[cfg(feature = "explain_binary")]
#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn explain_database_access(
    pool: &PgPool,
    database_id: &Uuid,
    source_ids: &SourceIds,
) -> Result<Vec<AccessGrant>, sqlx::Error> {
    let mut grants =
        list_entity_access_grants(pool, database_id, EntityType::Database, source_ids).await?;
    if source_ids.0.is_empty() {
        return Ok(grants);
    }
    let form_ids = sqlx::query_scalar!(
        r#"
        SELECT DISTINCT f.id
        FROM forms f
        JOIN entity_access ea ON ea.entity_id = f.id AND ea.entity_type = 'form'
        WHERE f.database_id = $1
        AND f.trashed_at IS NULL
        AND ea.source_id = ANY($2)
        AND ea.access_level IN ('edit', 'owner')
        ORDER BY f.id
        "#,
        database_id,
        &source_ids.0,
    )
    .fetch_all(pool)
    .await?;
    grants.extend(
        form_ids
            .into_iter()
            .map(|form_id| AccessGrant::ViaForm { form_id }),
    );
    Ok(grants)
}
