//! PostgreSQL implementation of the [`CollabSurfaceRepo`] port.

#[cfg(test)]
mod test;

use model_entity::{Entity, EntityType};
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{CollabSurface, SurfaceState};
use crate::domain::ports::CollabSurfaceRepo;

/// Postgres-backed collab-surface repository.
#[derive(Debug, Clone)]
pub struct PgCollabSurfaceRepo {
    pool: PgPool,
}

impl PgCollabSurfaceRepo {
    /// Create a repository backed by the provided pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// Errors produced by the Postgres collab-surface repository.
#[derive(Debug, thiserror::Error)]
pub enum CollabSurfaceRepoErr {
    /// Underlying database error.
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    /// A stored parent entity type could not be parsed into [`EntityType`].
    #[error("invalid parent entity type {value:?} stored for surface {surface_id}")]
    InvalidParentType {
        /// The surface carrying the bad value.
        surface_id: Uuid,
        /// The value that could not be parsed.
        value: String,
    },
    /// A stored state is not a known [`SurfaceState`].
    #[error("invalid state {value:?} stored for surface {surface_id}")]
    InvalidState {
        /// The surface carrying the bad value.
        surface_id: Uuid,
        /// The value that could not be parsed.
        value: String,
    },
}

/// A `collab_surfaces` row before parsing the enum-ish columns.
struct SurfaceRow {
    id: Uuid,
    parent_entity_type: String,
    parent_entity_id: Uuid,
    state: String,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
}

impl TryFrom<SurfaceRow> for CollabSurface {
    type Error = CollabSurfaceRepoErr;

    fn try_from(row: SurfaceRow) -> Result<Self, Self::Error> {
        let parent_type: EntityType = row.parent_entity_type.parse().map_err(|_| {
            CollabSurfaceRepoErr::InvalidParentType {
                surface_id: row.id,
                value: row.parent_entity_type.clone(),
            }
        })?;
        let state = SurfaceState::from_db_value(&row.state).ok_or_else(|| {
            CollabSurfaceRepoErr::InvalidState {
                surface_id: row.id,
                value: row.state.clone(),
            }
        })?;
        Ok(CollabSurface {
            id: row.id,
            parent: parent_type.with_entity_string(row.parent_entity_id.to_string()),
            state,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}

impl CollabSurfaceRepo for PgCollabSurfaceRepo {
    type Err = CollabSurfaceRepoErr;

    async fn insert(&self, surface: &CollabSurface) -> Result<bool, CollabSurfaceRepoErr> {
        // The parent id was validated as a uuid by the inbound layer; a
        // non-uuid here is a programming error surfaced as a Db error by the
        // failed parse below.
        let parent_id = surface
            .parent
            .entity_id
            .parse::<Uuid>()
            .map_err(|e| sqlx::Error::Decode(Box::new(e)))?;
        // Conflict-tolerant so concurrent ensures for the same id race safely:
        // exactly one caller inserts (true); the rest observe the existing row
        // (false) — including a soft-deleted one, which the service maps to
        // `Gone`.
        let result = sqlx::query!(
            r#"
            INSERT INTO collab_surfaces
                (id, parent_entity_type, parent_entity_id, state, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO NOTHING
            "#,
            surface.id,
            surface.parent.entity_type.to_string(),
            parent_id,
            surface.state.db_value(),
            surface.created_at,
            surface.updated_at,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn get(&self, id: Uuid) -> Result<Option<CollabSurface>, CollabSurfaceRepoErr> {
        let row = sqlx::query_as!(
            SurfaceRow,
            r#"
            SELECT id, parent_entity_type, parent_entity_id, state, created_at, updated_at
            FROM collab_surfaces
            WHERE id = $1 AND deleted_at IS NULL
            "#,
            id,
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(CollabSurface::try_from).transpose()
    }

    async fn list_by_parent(
        &self,
        parent: &Entity<'_>,
    ) -> Result<Vec<CollabSurface>, CollabSurfaceRepoErr> {
        let Ok(parent_id) = parent.entity_id.parse::<Uuid>() else {
            // A non-uuid parent can never have rows; read as empty.
            return Ok(Vec::new());
        };
        let rows = sqlx::query_as!(
            SurfaceRow,
            r#"
            SELECT id, parent_entity_type, parent_entity_id, state, created_at, updated_at
            FROM collab_surfaces
            WHERE parent_entity_type = $1 AND parent_entity_id = $2 AND deleted_at IS NULL
            ORDER BY created_at, id
            "#,
            parent.entity_type.to_string(),
            parent_id,
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(CollabSurface::try_from).collect()
    }

    async fn mark_ready(&self, id: Uuid) -> Result<(), CollabSurfaceRepoErr> {
        sqlx::query!(
            r#"
            UPDATE collab_surfaces
            SET state = 'ready', updated_at = now()
            WHERE id = $1 AND deleted_at IS NULL
            "#,
            id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn soft_delete(&self, id: Uuid) -> Result<(), CollabSurfaceRepoErr> {
        sqlx::query!(
            r#"
            UPDATE collab_surfaces
            SET deleted_at = now(), updated_at = now()
            WHERE id = $1 AND deleted_at IS NULL
            "#,
            id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
