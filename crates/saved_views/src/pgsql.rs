use crate::{
    ExcludedDefaultView, View,
    storage::{ExcludedDefaultViewStorage, ViewPatch, ViewStorage},
};
use sqlx::PgPool;
use uuid::Uuid;

pub struct PgViewStorage {
    pool: PgPool,
}

impl PgViewStorage {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl ViewStorage for PgViewStorage {
    type Err = sqlx::Error;

    #[tracing::instrument(skip(self), err)]
    async fn get_view(&self, id: Uuid) -> Result<View, Self::Err> {
        sqlx::query_as!(
            View,
            "SELECT id, user_id, name, config, created_at, updated_at FROM saved_view WHERE id = $1",
            id
        )
        .fetch_one(&self.pool)
        .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn create_view(&self, view: &View) -> Result<(), Self::Err> {
        sqlx::query!(
            "INSERT INTO saved_view (id, user_id, name, config, created_at, updated_at) 
             VALUES ($1, $2, $3, $4, $5, $6)",
            view.id,
            view.user_id,
            view.name,
            view.config,
            view.created_at,
            view.updated_at
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_views_for_user(&self, user_id: &str) -> Result<Vec<View>, Self::Err> {
        sqlx::query_as!(
            View,
            "SELECT id, user_id, name, config, created_at, updated_at FROM saved_view WHERE user_id = $1",
            user_id
        )
        .fetch_all(&self.pool)
        .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn patch_view(&self, id: Uuid, patch: ViewPatch) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
           UPDATE saved_view
           SET 
               name = COALESCE($2, name),
               config = CASE 
                   WHEN $3::jsonb IS NOT NULL THEN config || $3 
                   ELSE config 
               END,
               updated_at = NOW()
           WHERE id = $1
           "#,
            id,
            patch.name,
            patch.config as Option<serde_json::Value>
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_view(&self, id: Uuid) -> Result<(), Self::Err> {
        sqlx::query!("DELETE FROM saved_view WHERE id = $1", id)
            .execute(&self.pool)
            .await?;

        Ok(())
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
