use crate::{ExcludedDefaultView, View, storage::ExcludedDefaultViewStorage};
use sqlx::PgPool;
use uuid::Uuid;

pub struct PgViewStorage {
    pool: PgPool,
}

impl PgViewStorage {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    // Serialize first creation and deletion, including IDs without a live row.
    async fn begin_write(
        &self,
        id: Uuid,
    ) -> Result<sqlx::Transaction<'static, sqlx::Postgres>, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let key = format!("saved-view:{id}");
        sqlx::query!("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", key)
            .execute(&mut *tx)
            .await?;
        Ok(tx)
    }
}

impl ExcludedDefaultViewStorage for PgViewStorage {
    type Err = sqlx::Error;

    #[tracing::instrument(skip(self), err)]
    async fn create_excluded_default_view(
        &self,
        view: ExcludedDefaultView,
    ) -> Result<(), Self::Err> {
        sqlx::query!(
            "INSERT INTO excluded_default_view (id, user_id, default_view_id)
         VALUES ($1, $2, $3)",
            view.id,
            view.user_id,
            view.default_view_id
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn get_excluded_default_views_for_user(
        &self,
        user_id: &str,
    ) -> Result<Vec<ExcludedDefaultView>, Self::Err> {
        sqlx::query_as!(
            ExcludedDefaultView,
            "SELECT id, user_id, default_view_id FROM excluded_default_view WHERE user_id = $1",
            user_id
        )
        .fetch_all(&self.pool)
        .await
    }
}

impl crate::domain::ViewRepository for PgViewStorage {
    type Err = sqlx::Error;

    #[tracing::instrument(skip(self), err)]
    async fn get(&self, id: Uuid) -> Result<Option<View>, Self::Err> {
        sqlx::query_as!(View, "SELECT id, user_id, name, config, created_at, updated_at, revision, shared_team_id FROM saved_view WHERE id = $1", id)
            .fetch_optional(&self.pool).await
    }

    async fn legacy_list(&self, viewer: &str) -> Result<Vec<View>, Self::Err> {
        sqlx::query_as!(View,
            "SELECT id, user_id, name, config, created_at, updated_at, revision, shared_team_id FROM saved_view WHERE user_id = $1",
            viewer
        ).fetch_all(&self.pool).await
    }

    #[tracing::instrument(skip(self, view), fields(view_id = %view.id), err)]
    async fn create(&self, view: &View) -> Result<Option<View>, Self::Err> {
        let mut tx = self.begin_write(view.id).await?;
        let deleted = sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM saved_view_tombstone WHERE id = $1) AS "exists!""#,
            view.id
        )
        .fetch_one(&mut *tx)
        .await?;
        if deleted {
            return Ok(None);
        }
        sqlx::query!(
            "INSERT INTO saved_view (id, user_id, name, config, created_at, updated_at, shared_team_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING",
            view.id, view.user_id, view.name, view.config, view.created_at, view.updated_at,
            view.shared_team_id,
        ).execute(&mut *tx).await?;
        // A legacy delete can commit while INSERT waits on the old row. Check
        // again in a fresh statement snapshot before making a replacement live.
        let deleted = sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM saved_view_tombstone WHERE id = $1) AS "exists!""#,
            view.id
        )
        .fetch_one(&mut *tx)
        .await?;
        if deleted {
            tx.rollback().await?;
            return Ok(None);
        }
        let created = sqlx::query_as!(View, "SELECT id, user_id, name, config, created_at, updated_at, revision, shared_team_id FROM saved_view WHERE id = $1", view.id)
            .fetch_optional(&mut *tx).await?;
        tx.commit().await?;
        Ok(created)
    }

    #[tracing::instrument(skip_all, fields(limit, kind), err)]
    async fn list_views_for_access_check(
        &self,
        viewer: &str,
        team_ids: &[Uuid],
        kind: Option<&str>,
        after: Option<crate::domain::Cursor>,
        limit: i64,
    ) -> Result<Vec<View>, Self::Err> {
        sqlx::query_as!(
            View,
            "SELECT id, user_id, name, config, created_at, updated_at, revision, shared_team_id
             FROM saved_view
             WHERE (user_id = $1 OR shared_team_id = ANY($2::uuid[]))
               AND ($3::text IS NULL OR config->>'kind' = $3)
               AND ($4::timestamptz IS NULL OR (created_at, id) > ($4, $5))
             ORDER BY created_at, id LIMIT $6",
            viewer,
            team_ids,
            kind,
            after.map(|c| c.created_at),
            after.map(|c| c.id),
            limit
        )
        .fetch_all(&self.pool)
        .await
    }

    #[tracing::instrument(skip_all, fields(view_id = %id, revision), err)]
    async fn update(
        &self,
        id: Uuid,
        owner: &str,
        revision: i64,
        changes: crate::domain::ViewChanges<'_>,
    ) -> Result<Option<View>, Self::Err> {
        sqlx::query_as!(
            View,
            "UPDATE saved_view SET name = COALESCE($4, name), config = COALESCE($5, config),
                shared_team_id = $6,
                revision = revision + 1, updated_at = NOW()
             WHERE id = $1 AND user_id = $2 AND revision = $3
             RETURNING id, user_id, name, config, created_at, updated_at, revision, shared_team_id",
            id,
            owner,
            revision,
            changes.name,
            changes.config,
            changes.shared_team_id
        )
        .fetch_optional(&self.pool)
        .await
    }

    #[tracing::instrument(skip_all, fields(view_id = %id, revision), err)]
    async fn delete(&self, id: Uuid, owner: &str, revision: i64) -> Result<bool, Self::Err> {
        let mut tx = self.begin_write(id).await?;
        let deleted = sqlx::query!(
            "DELETE FROM saved_view WHERE id = $1 AND user_id = $2 AND revision = $3",
            id,
            owner,
            revision
        )
        .execute(&mut *tx)
        .await?
        .rows_affected()
            != 0;
        tx.commit().await?;
        Ok(deleted)
    }

    #[tracing::instrument(skip_all, fields(view_id = %id), err)]
    async fn legacy_patch(
        &self,
        id: Uuid,
        owner: &str,
        name: Option<&str>,
        config: Option<&serde_json::Value>,
    ) -> Result<bool, Self::Err> {
        Ok(sqlx::query!(
            "UPDATE saved_view SET name = COALESCE($3, name),
                config = CASE WHEN $4::jsonb IS NULL THEN config ELSE config || $4 END,
                revision = revision + 1, updated_at = NOW()
             WHERE id = $1 AND user_id = $2",
            id,
            owner,
            name,
            config
        )
        .execute(&self.pool)
        .await?
        .rows_affected()
            != 0)
    }

    #[tracing::instrument(skip_all, fields(view_id = %id), err)]
    async fn legacy_delete(&self, id: Uuid, owner: &str) -> Result<bool, Self::Err> {
        let mut tx = self.begin_write(id).await?;
        let deleted = sqlx::query!(
            "DELETE FROM saved_view WHERE id = $1 AND user_id = $2",
            id,
            owner
        )
        .execute(&mut *tx)
        .await?
        .rows_affected()
            != 0;
        tx.commit().await?;
        Ok(deleted)
    }
}
