//! Favorites follow a merged entity to the one that stays, inside the
//! merging domain's transaction.

#[cfg(test)]
mod tests;

use chrono::{DateTime, Utc};
use model_entity::EntityType;
use sqlx::PgConnection;

/// A favorite of a merged entity, as it was before the merge.
#[derive(Debug, Clone, PartialEq)]
pub struct MergedFavorite {
    /// Whose favorite it was.
    pub user_id: String,
    /// The merged entity it pointed at.
    pub entity_id: String,
    /// Its place in the user's list.
    pub sort_order: f64,
    /// When it was added.
    pub created_at: DateTime<Utc>,
    /// When it was last touched.
    pub updated_at: DateTime<Utc>,
}

/// Point every favorite of `sources` at `survivor`. A user keeps one favorite:
/// the one they already had of the survivor, else their first-placed source
/// favorite, in its place. Returns the source favorites as they were.
#[tracing::instrument(name = "favorites.merge", skip_all, fields(sources = sources.len(), moved = tracing::field::Empty), err)]
pub async fn retarget_favorites_in(
    conn: &mut PgConnection,
    entity_type: EntityType,
    sources: &[String],
    survivor: &str,
) -> Result<Vec<MergedFavorite>, sqlx::Error> {
    let entity_type: &str = entity_type.into();
    let moved = sqlx::query_as!(
        MergedFavorite,
        r#"WITH moved AS (
               DELETE FROM favorite
               WHERE entity_type = $1 AND entity_id = ANY($2)
               RETURNING user_id, entity_id, sort_order, created_at, updated_at
           ), kept AS (
               INSERT INTO favorite (user_id, entity_type, entity_id, sort_order, created_at)
               SELECT DISTINCT ON (user_id) user_id, $1, $3, sort_order, created_at
               FROM moved
               ORDER BY user_id, sort_order, entity_id
               ON CONFLICT (user_id, entity_type, entity_id) DO NOTHING
           )
           SELECT user_id AS "user_id!", entity_id AS "entity_id!", sort_order AS "sort_order!",
                  created_at AS "created_at!", updated_at AS "updated_at!"
           FROM moved
           ORDER BY user_id, entity_id"#,
        entity_type,
        sources,
        survivor,
    )
    .fetch_all(conn)
    .await?;
    tracing::Span::current().record("moved", moved.len());
    Ok(moved)
}
