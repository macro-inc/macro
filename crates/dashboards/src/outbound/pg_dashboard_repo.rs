//! Dashboards in MacroDB: `dashboard_entities`, `dashboard_versions` and
//! `dashboard_homes`, with the owner's grant in `entity_access`.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use dynamic_ui::View;
use entity_access_db_utils::{EntityType, upsert_owner_grant};
use macro_user_id::user_id::MacroUserIdStr;
use model_owner::Owner;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{
    DashboardHead, DashboardId, DashboardSummary, DashboardVersion, DashboardVersionSummary,
    NewDashboard, NewVersion, StoredDashboard, Version,
};
use crate::domain::ports::DashboardRepo;

/// Postgres dashboard storage.
#[derive(Clone)]
pub struct PgDashboardRepo {
    pool: PgPool,
}

impl PgDashboardRepo {
    /// Wrap a MacroDB pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// A storage failure.
#[derive(Debug, thiserror::Error)]
pub enum PgDashboardRepoError {
    /// The query failed.
    #[error("dashboard query failed")]
    Sqlx(#[from] sqlx::Error),
    /// A stored row doesn't decode: a user id or a version.
    #[error("stored dashboard is malformed: {0}")]
    Malformed(String),
}

fn malformed(error: impl std::fmt::Display) -> PgDashboardRepoError {
    PgDashboardRepoError::Malformed(error.to_string())
}

fn user_id(id: String) -> Result<MacroUserIdStr<'static>, PgDashboardRepoError> {
    MacroUserIdStr::try_from(id).map_err(malformed)
}

fn version(value: i32) -> Result<Version, PgDashboardRepoError> {
    u32::try_from(value).map(Version).map_err(malformed)
}

fn stored_version(version: Version) -> Result<i32, PgDashboardRepoError> {
    i32::try_from(version.0).map_err(malformed)
}

/// The current view's title, trimmed, as lists show it.
fn title(view: &View) -> Option<String> {
    view.title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(str::to_owned)
}

struct DashboardRow {
    id: Uuid,
    user_id: String,
    title: Option<String>,
    current_version: i32,
    view: serde_json::Value,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl TryFrom<DashboardRow> for StoredDashboard {
    type Error = PgDashboardRepoError;

    fn try_from(row: DashboardRow) -> Result<Self, Self::Error> {
        Ok(Self {
            id: DashboardId(row.id),
            owner_id: user_id(row.user_id)?,
            title: row.title,
            version: version(row.current_version)?,
            view: row.view,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}

impl DashboardRepo for PgDashboardRepo {
    type Err = PgDashboardRepoError;

    #[tracing::instrument(skip_all, fields(dashboard_id = %dashboard.id), err)]
    async fn create(&self, dashboard: &NewDashboard) -> Result<StoredDashboard, Self::Err> {
        let view = serde_json::to_value(&dashboard.view).map_err(malformed)?;
        let title = title(&dashboard.view);
        let mut tx = self.pool.begin().await?;

        let row = sqlx::query!(
            r#"
            INSERT INTO dashboard_entities (id, user_id, title, current_version)
            VALUES ($1, $2, $3, 1)
            RETURNING created_at, updated_at
            "#,
            dashboard.id.0,
            dashboard.owner_id.as_ref(),
            title,
        )
        .fetch_one(tx.as_mut())
        .await?;

        sqlx::query!(
            r#"
            INSERT INTO dashboard_versions (dashboard_id, version, view, author_id)
            VALUES ($1, 1, $2, $3)
            "#,
            dashboard.id.0,
            view,
            dashboard.owner_id.as_ref(),
        )
        .execute(tx.as_mut())
        .await?;

        upsert_owner_grant(
            &mut tx,
            &dashboard.id.0,
            EntityType::Dashboard,
            &Owner::User(dashboard.owner_id.clone()),
        )
        .await?;

        tx.commit().await?;

        Ok(StoredDashboard {
            id: dashboard.id,
            owner_id: dashboard.owner_id.clone(),
            title,
            version: Version::FIRST,
            view,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }

    #[tracing::instrument(skip_all, fields(dashboard_id = %id), err)]
    async fn head(&self, id: DashboardId) -> Result<Option<DashboardHead>, Self::Err> {
        let row = sqlx::query!(
            "SELECT user_id, current_version FROM dashboard_entities WHERE id = $1",
            id.0,
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(|row| {
            Ok(DashboardHead {
                id,
                owner_id: user_id(row.user_id)?,
                version: version(row.current_version)?,
            })
        })
        .transpose()
    }

    #[tracing::instrument(skip_all, fields(dashboard_id = %id), err)]
    async fn get(&self, id: DashboardId) -> Result<Option<StoredDashboard>, Self::Err> {
        let row = sqlx::query_as!(
            DashboardRow,
            r#"
            SELECT d.id, d.user_id, d.title, d.current_version, v.view, d.created_at, d.updated_at
            FROM dashboard_entities d
            JOIN dashboard_versions v ON v.dashboard_id = d.id AND v.version = d.current_version
            WHERE d.id = $1
            "#,
            id.0,
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(StoredDashboard::try_from).transpose()
    }

    #[tracing::instrument(skip_all, fields(limit), err)]
    async fn list_owned(
        &self,
        owner: &MacroUserIdStr<'_>,
        limit: u32,
    ) -> Result<Vec<DashboardSummary>, Self::Err> {
        let rows = sqlx::query!(
            r#"
            SELECT id, user_id, title, current_version, updated_at
            FROM dashboard_entities
            WHERE user_id = $1
            ORDER BY updated_at DESC
            LIMIT $2
            "#,
            owner.as_ref(),
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(DashboardSummary {
                    id: DashboardId(row.id),
                    owner_id: user_id(row.user_id)?,
                    title: row.title,
                    version: version(row.current_version)?,
                    updated_at: row.updated_at,
                })
            })
            .collect()
    }

    #[tracing::instrument(skip_all, fields(dashboard_id = %new.id, replaces = new.replaces.0), err)]
    async fn save_version(&self, new: &NewVersion) -> Result<Option<StoredDashboard>, Self::Err> {
        let view = serde_json::to_value(&new.view).map_err(malformed)?;
        let title = title(&new.view);
        let replaces = stored_version(new.replaces)?;
        let mut tx = self.pool.begin().await?;

        // Moving the pointer only from the version the save read is the
        // compare-and-set: of two saves on one version, one updates no row.
        let row = sqlx::query!(
            r#"
            UPDATE dashboard_entities
            SET current_version = current_version + 1, title = $3, updated_at = now()
            WHERE id = $1 AND current_version = $2
            RETURNING user_id, current_version, created_at, updated_at
            "#,
            new.id.0,
            replaces,
            title,
        )
        .fetch_optional(tx.as_mut())
        .await?;

        let Some(row) = row else {
            return Ok(None);
        };

        sqlx::query!(
            r#"
            INSERT INTO dashboard_versions (dashboard_id, version, view, author_id)
            VALUES ($1, $2, $3, $4)
            "#,
            new.id.0,
            row.current_version,
            view,
            new.author_id.as_ref(),
        )
        .execute(tx.as_mut())
        .await?;

        tx.commit().await?;

        Ok(Some(StoredDashboard {
            id: new.id,
            owner_id: user_id(row.user_id)?,
            title,
            version: version(row.current_version)?,
            view,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }))
    }

    #[tracing::instrument(skip_all, fields(dashboard_id = %id, limit), err)]
    async fn versions(
        &self,
        id: DashboardId,
        limit: u32,
    ) -> Result<Vec<DashboardVersionSummary>, Self::Err> {
        let rows = sqlx::query!(
            r#"
            SELECT version, author_id, created_at
            FROM dashboard_versions
            WHERE dashboard_id = $1
            ORDER BY version DESC
            LIMIT $2
            "#,
            id.0,
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(DashboardVersionSummary {
                    version: version(row.version)?,
                    author_id: user_id(row.author_id)?,
                    created_at: row.created_at,
                })
            })
            .collect()
    }

    #[tracing::instrument(skip_all, fields(dashboard_id = %id, version = number.0), err)]
    async fn version(
        &self,
        id: DashboardId,
        number: Version,
    ) -> Result<Option<DashboardVersion>, Self::Err> {
        let row = sqlx::query!(
            r#"
            SELECT version, author_id, created_at, view
            FROM dashboard_versions
            WHERE dashboard_id = $1 AND version = $2
            "#,
            id.0,
            stored_version(number)?,
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(|row| {
            Ok(DashboardVersion {
                version: version(row.version)?,
                author_id: user_id(row.author_id)?,
                created_at: row.created_at,
                view: row.view,
            })
        })
        .transpose()
    }

    #[tracing::instrument(skip_all, fields(dashboard_id = %id), err)]
    async fn delete(&self, id: DashboardId) -> Result<bool, Self::Err> {
        // Versions and homes cascade; a trigger removes the grants.
        let deleted = sqlx::query!("DELETE FROM dashboard_entities WHERE id = $1", id.0)
            .execute(&self.pool)
            .await?;

        Ok(deleted.rows_affected() > 0)
    }

    #[tracing::instrument(skip_all, fields(dashboard_id = %id), err)]
    async fn set_home(&self, user: &MacroUserIdStr<'_>, id: DashboardId) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            INSERT INTO dashboard_homes (user_id, dashboard_id)
            VALUES ($1, $2)
            ON CONFLICT (user_id) DO UPDATE
            SET dashboard_id = EXCLUDED.dashboard_id, updated_at = now()
            "#,
            user.as_ref(),
            id.0,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[tracing::instrument(skip_all, err)]
    async fn clear_home(&self, user: &MacroUserIdStr<'_>) -> Result<(), Self::Err> {
        sqlx::query!(
            "DELETE FROM dashboard_homes WHERE user_id = $1",
            user.as_ref()
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[tracing::instrument(skip_all, err)]
    async fn home(&self, user: &MacroUserIdStr<'_>) -> Result<Option<DashboardId>, Self::Err> {
        let id = sqlx::query_scalar!(
            "SELECT dashboard_id FROM dashboard_homes WHERE user_id = $1",
            user.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(id.map(DashboardId))
    }
}
