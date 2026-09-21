//! Which databases a viewer can reach, from the shared `entity_access` table.
//!
//! Which source ids stand for a viewer is `entity_access`'s own question, so
//! it is asked there ([`entity_access::outbound::get_user_source_ids`]) rather
//! than re-derived here: a second copy of that rule is a permission bug
//! waiting to happen, and the copy this replaced had already drifted. The
//! highest grant wins.

#[cfg(test)]
mod test;

use entity_access::outbound::get_user_source_ids;
use rootcause::compat::IntoRootcause;
use sqlx::PgPool;

use crate::domain::models::{AccessGrant, DatabaseId, Viewer};
use crate::domain::ports::AccessDirectory;

/// Errors from the access directory.
#[derive(Debug, thiserror::Error)]
pub enum PgAccessDirectoryError {
    /// Underlying database failure.
    #[error("database error")]
    Sqlx(#[from] sqlx::Error),
    /// The viewer's `entity_access` source ids could not be resolved.
    #[error("failed to resolve viewer source ids: {0:?}")]
    SourceIds(rootcause::Report),
}

/// [`AccessDirectory`] over MacroDB's `entity_access`.
#[derive(Debug, Clone)]
pub struct PgAccessDirectory {
    pool: PgPool,
}

impl PgAccessDirectory {
    /// Create a directory over the given pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl AccessDirectory for PgAccessDirectory {
    type Err = PgAccessDirectoryError;

    #[tracing::instrument(skip(self, viewer), err)]
    async fn accessible_databases(
        &self,
        viewer: &Viewer,
    ) -> Result<Vec<(DatabaseId, AccessGrant)>, Self::Err> {
        let source_ids = get_user_source_ids(&self.pool, Some(&viewer.user_id))
            .await
            .map_err(|e| PgAccessDirectoryError::SourceIds(e.into_rootcause()))?;
        let rows = sqlx::query!(
            r#"
            SELECT DISTINCT ON (ea.entity_id)
                ea.entity_id AS "entity_id!",
                ea.access_level::text AS "access_level!"
            FROM entity_access ea
            JOIN databases d ON d.id = ea.entity_id AND d.trashed_at IS NULL
            WHERE ea.entity_type = 'database'
              AND ea.source_id = ANY($1)
            ORDER BY ea.entity_id,
                CASE ea.access_level::text
                    WHEN 'owner' THEN 4
                    WHEN 'edit' THEN 3
                    WHEN 'comment' THEN 2
                    WHEN 'view' THEN 1
                    ELSE 0
                END DESC
            "#,
            &source_ids.0,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .filter_map(|row| Some((row.entity_id, AccessGrant::parse(&row.access_level)?)))
            .collect())
    }
}
