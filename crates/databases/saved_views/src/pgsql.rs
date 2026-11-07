use crate::{
    ExcludedDefaultView, View, domain::PositionedView, storage::ExcludedDefaultViewStorage,
};
use sqlx::PgPool;
use uuid::Uuid;

#[cfg(test)]
mod test;

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

    #[tracing::instrument(skip_all, fields(count = ids.len()), err)]
    async fn get_many(&self, ids: &[Uuid]) -> Result<Vec<View>, Self::Err> {
        sqlx::query_as!(
            View,
            "SELECT id, user_id, name, config, created_at, updated_at, revision, shared_team_id
             FROM saved_view WHERE id = ANY($1::uuid[])",
            ids
        )
        .fetch_all(&self.pool)
        .await
    }

    // Unplaced views sort after placed ones; the sentinel stays inside SQL.
    #[tracing::instrument(skip_all, fields(limit, kind), err)]
    async fn list_views_for_access_check(
        &self,
        viewer: &str,
        team_ids: &[Uuid],
        kind: Option<&str>,
        after: Option<crate::domain::Cursor>,
        limit: i64,
    ) -> Result<Vec<PositionedView>, Self::Err> {
        let rows = sqlx::query!(
            r#"SELECT v.id, v.user_id, v.name, v.config, v.created_at, v.updated_at, v.revision,
                    v.shared_team_id, p.position AS "position?"
             FROM saved_view v
             LEFT JOIN saved_view_position p ON p.saved_view_id = v.id AND p.user_id = $1
             WHERE (v.user_id = $1 OR v.shared_team_id = ANY($2::uuid[]))
               AND ($3::text IS NULL OR v.config->>'kind' = $3)
               AND ($5::timestamptz IS NULL
                    OR (COALESCE(p.position, 2147483647), v.created_at, v.id)
                       > (COALESCE($4::int, 2147483647), $5, $6))
             ORDER BY COALESCE(p.position, 2147483647), v.created_at, v.id LIMIT $7"#,
            viewer,
            team_ids,
            kind,
            after.and_then(|c| c.position),
            after.map(|c| c.created_at),
            after.map(|c| c.id),
            limit
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| PositionedView {
                view: View {
                    id: row.id,
                    user_id: row.user_id,
                    name: row.name,
                    config: row.config,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    revision: row.revision,
                    shared_team_id: row.shared_team_id,
                },
                position: row.position,
            })
            .collect())
    }

    #[tracing::instrument(skip_all, fields(kind, count = ids.len()), err)]
    async fn set_positions(&self, viewer: &str, kind: &str, ids: &[Uuid]) -> Result<(), Self::Err> {
        let mut tx = self.pool.begin().await?;
        // Serialize one viewer's reorders of a kind so the last one wins whole.
        let key = format!("saved-view-order:{viewer}:{kind}");
        sqlx::query!("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", key)
            .execute(&mut *tx)
            .await?;
        sqlx::query!(
            "DELETE FROM saved_view_position p USING saved_view v
             WHERE p.saved_view_id = v.id AND p.user_id = $1 AND v.config->>'kind' = $2",
            viewer,
            kind
        )
        .execute(&mut *tx)
        .await?;
        // Joining saved_view skips a view deleted since the service checked it.
        sqlx::query!(
            "INSERT INTO saved_view_position (user_id, saved_view_id, position)
             SELECT $1, v.id, (ordered.ord - 1)::int
             FROM unnest($2::uuid[]) WITH ORDINALITY AS ordered(id, ord)
             JOIN saved_view v ON v.id = ordered.id
             ON CONFLICT (user_id, saved_view_id) DO UPDATE SET position = EXCLUDED.position",
            viewer,
            ids
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await
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
