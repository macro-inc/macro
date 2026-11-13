//! Query for database access level.

#[cfg(feature = "explain_binary")]
use crate::{
    domain::models::AccessGrant, outbound::pg_access_repo::queries::list_entity_access_grants,
};
use crate::{domain::models::AccessLevel, outbound::pg_access_repo::queries::Viewer};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
#[cfg(feature = "explain_binary")]
use model_entity::EntityType;
use sqlx::PgPool;
use std::collections::BTreeMap;
use std::str::FromStr;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// The highest access level a viewer holds on a database: its own grants,
/// Edit through edit or owner on any live form over it, so form editors
/// can read and change their responses, and View through view on a live form
/// that shares its responses. View on a form grants nothing here otherwise.
/// Databases have no share link, so there is no public-sharing arm; a team
/// share is a team-source grant like any other.
/// Both grant paths require an app entity; core storage alone is not shareable.
#[tracing::instrument(err, skip(pool, viewer))]
pub(crate) async fn get_database_access(
    pool: &PgPool,
    database_id: &uuid::Uuid,
    viewer: Viewer<'_>,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    if viewer.is_anonymous() {
        return Ok(None);
    }

    let all_level_strings: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        SELECT access_level::text
        FROM entity_access
        JOIN database_entities d ON d.database_id = entity_access.entity_id
        WHERE entity_id = $1
        AND entity_type = 'database'
        AND EXISTS (SELECT FROM entity_access_source_matches(source_id, $2, $3))

        UNION ALL

        SELECT 'edit'
        FROM forms f
        JOIN database_entities d ON d.database_id = f.database_id
        JOIN entity_access ea ON ea.entity_id = f.id AND ea.entity_type = 'form'
        WHERE f.database_id = $1
        AND f.trashed_at IS NULL
        AND EXISTS (SELECT FROM entity_access_source_matches(ea.source_id, $2, $3))
        AND ea.access_level IN ('edit', 'owner')

        UNION ALL

        SELECT 'view'
        FROM forms f
        JOIN database_entities d ON d.database_id = f.database_id
        JOIN entity_access ea ON ea.entity_id = f.id AND ea.entity_type = 'form'
        WHERE f.database_id = $1
        AND f.trashed_at IS NULL
        AND f.responses_visible
        AND EXISTS (SELECT FROM entity_access_source_matches(ea.source_id, $2, $3))
        AND ea.access_level = 'view'
        "#,
        database_id,
        viewer.id(),
        viewer.scope_team(),
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

/// The highest access level a user has on every database their sources
/// reach, directly, as Edit through a live form they edit, or as View through
/// a live form that shares its responses, ordered by database id. Trash is
/// the databases domain's concern: a trashed database's grants are still listed.
#[tracing::instrument(err, skip(pool, user_id))]
pub(crate) async fn list_database_access(
    pool: &PgPool,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Vec<(Uuid, AccessLevel)>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        SELECT entity_id AS "entity_id!", access_level AS "access_level!: AccessLevel"
        FROM entity_access
        JOIN database_entities d ON d.database_id = entity_access.entity_id
        WHERE entity_type = 'database'
        AND source_id = ANY(ARRAY(SELECT s.source FROM entity_access_viewer_sources($1, NULL) s(source)))

        UNION ALL

        SELECT f.database_id, 'edit'::"AccessLevel"
        FROM entity_access ea
        JOIN forms f ON f.id = ea.entity_id
        JOIN database_entities d ON d.database_id = f.database_id
        WHERE ea.entity_type = 'form'
        AND ea.source_id = ANY(ARRAY(SELECT s.source FROM entity_access_viewer_sources($1, NULL) s(source)))
        AND ea.access_level IN ('edit', 'owner')
        AND f.trashed_at IS NULL

        UNION ALL

        SELECT f.database_id, 'view'::"AccessLevel"
        FROM entity_access ea
        JOIN forms f ON f.id = ea.entity_id
        JOIN database_entities d ON d.database_id = f.database_id
        WHERE ea.entity_type = 'form'
        AND ea.source_id = ANY(ARRAY(SELECT s.source FROM entity_access_viewer_sources($1, NULL) s(source)))
        AND ea.access_level = 'view'
        AND f.responses_visible
        AND f.trashed_at IS NULL
        "#,
        user_id.as_ref(),
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
#[tracing::instrument(err, skip(pool, user_id))]
pub async fn explain_database_access(
    pool: &PgPool,
    database_id: &Uuid,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Vec<AccessGrant>, sqlx::Error> {
    let mut grants =
        list_entity_access_grants(pool, database_id, EntityType::Database, user_id).await?;
    let form_ids = sqlx::query_scalar!(
        r#"
        SELECT DISTINCT f.id
        FROM forms f
        JOIN database_entities d ON d.database_id = f.database_id
        JOIN entity_access ea ON ea.entity_id = f.id AND ea.entity_type = 'form'
        WHERE f.database_id = $1
        AND f.trashed_at IS NULL
        AND EXISTS (SELECT FROM entity_access_source_matches(ea.source_id, $2, NULL))
        AND (
            ea.access_level IN ('edit', 'owner')
            OR (ea.access_level = 'view' AND f.responses_visible)
        )
        ORDER BY f.id
        "#,
        database_id,
        user_id.as_ref(),
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
