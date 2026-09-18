//! Which databases a viewer can reach, from the shared `entity_access` table.
//!
//! Source ids follow the same rule as every other entity listing in MacroDB
//! (`list_documents_with_access`): the user themself, their teams, and the
//! channels they participate in. The highest grant wins.

use sqlx::PgPool;

use crate::domain::models::{AccessGrant, DatabaseId, Viewer};
use crate::domain::ports::AccessDirectory;

/// Errors from the access directory.
#[derive(Debug, thiserror::Error)]
pub enum PgAccessDirectoryError {
    /// Underlying database failure.
    #[error("database error")]
    Sqlx(#[from] sqlx::Error),
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
        let user_id: &str = viewer.user_id.as_ref();
        let rows = sqlx::query!(
            r#"
            WITH user_source_ids AS (
                SELECT cp.channel_id::text AS source_id FROM comms_channel_participants cp
                    WHERE cp.user_id = $1 AND cp.left_at IS NULL
                UNION ALL
                SELECT t.team_id::text FROM team_user t
                    WHERE t.user_id = $1
                UNION ALL
                SELECT $1
            )
            SELECT DISTINCT ON (ea.entity_id)
                ea.entity_id AS "entity_id!",
                ea.access_level::text AS "access_level!"
            FROM entity_access ea
            JOIN databases d ON d.id = ea.entity_id AND d.trashed_at IS NULL
            WHERE ea.entity_type = 'database'
              AND ea.source_id = ANY(SELECT source_id FROM user_source_ids)
            ORDER BY ea.entity_id,
                CASE ea.access_level::text
                    WHEN 'owner' THEN 4
                    WHEN 'edit' THEN 3
                    WHEN 'comment' THEN 2
                    WHEN 'view' THEN 1
                    ELSE 0
                END DESC
            "#,
            user_id,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .filter_map(|row| Some((row.entity_id, AccessGrant::parse(&row.access_level)?)))
            .collect())
    }
}
