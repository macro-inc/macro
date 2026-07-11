//! Implementation of [`AiProjectionRepository`] backed by MacroDB.

use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

use crate::domain::{
    ai_projection_repo::AiProjectionRepository,
    model::{
        AiProjection, AiProjectionError, Expiry, ProjectionStatus, RefreshCadence, TargetType,
        UserAiProjection,
    },
};

#[cfg(test)]
mod test;

/// The AiProjectionRepositoryImpl is a wrapper around a sqlx::PgPool connected
/// to macrodb.
#[derive(Clone)]
pub struct AiProjectionRepositoryImpl {
    /// The underlying sqlx::PgPool connected to macrodb.
    pool: PgPool,
}

impl AiProjectionRepositoryImpl {
    /// Creates a new instance of AiProjectionRepositoryImpl.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl AiProjectionRepository for AiProjectionRepositoryImpl {
    #[tracing::instrument(skip(self, prompt, output_schema), err)]
    async fn upsert_projection_definition(
        &self,
        id: &str,
        prompt: &str,
        prompt_hash: &str,
        target_type: TargetType,
        refresh_cadence: RefreshCadence,
        expiry: Expiry,
        model: Option<&str>,
        output_schema: Option<&serde_json::Value>,
    ) -> Result<AiProjection, AiProjectionError> {
        // Insert if absent; revise an existing definition only when something
        // actually changed so routine requests don't churn the row.
        sqlx::query!(
            r#"
            INSERT INTO ai_projection (id, prompt, prompt_hash, target_type, refresh_cadence, expiry, model, output_schema)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO UPDATE SET
                prompt = EXCLUDED.prompt,
                prompt_hash = EXCLUDED.prompt_hash,
                target_type = EXCLUDED.target_type,
                refresh_cadence = EXCLUDED.refresh_cadence,
                expiry = EXCLUDED.expiry,
                model = EXCLUDED.model,
                output_schema = EXCLUDED.output_schema,
                updated_at = NOW()
            WHERE ai_projection.prompt_hash IS DISTINCT FROM EXCLUDED.prompt_hash
               OR ai_projection.target_type IS DISTINCT FROM EXCLUDED.target_type
               OR ai_projection.refresh_cadence IS DISTINCT FROM EXCLUDED.refresh_cadence
               OR ai_projection.expiry IS DISTINCT FROM EXCLUDED.expiry
            "#,
            id,
            prompt,
            prompt_hash,
            target_type.to_string(),
            refresh_cadence.to_string(),
            expiry.to_string(),
            model,
            output_schema,
        )
        .execute(&self.pool)
        .await
        .map_err(sqlx_err)?;

        let row = sqlx::query!(
            r#"
            SELECT id, prompt, prompt_hash, target_type, refresh_cadence, expiry, model, output_schema, created_at, updated_at
            FROM ai_projection
            WHERE id = $1
            "#,
            id,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(sqlx_err)?;

        Ok(AiProjection {
            id: row.id,
            prompt: row.prompt,
            prompt_hash: row.prompt_hash,
            target_type: row.target_type.parse()?,
            refresh_cadence: row.refresh_cadence.parse()?,
            expiry: row.expiry.parse()?,
            model: row.model,
            output_schema: row.output_schema,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_or_create_target_projection(
        &self,
        ai_projection_id: &str,
        target_id: &str,
        prompt_hash: &str,
    ) -> Result<UserAiProjection, AiProjectionError> {
        // A request for a projection bumps `last_requested_at` so the background
        // refresh handler can tell active instances apart from abandoned ones
        // (which it eventually deletes once they fall outside their expiry
        // window). An instance created for an older prompt version is reset to
        // cold — its previous result stays visible until regeneration
        // overwrites it — while a same-version instance keeps its status.
        sqlx::query!(
            r#"
            INSERT INTO user_ai_projection (ai_projection_id, target_id, prompt_hash, status)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (target_id, ai_projection_id)
            DO UPDATE SET
                last_requested_at = NOW(),
                updated_at = NOW(),
                status = CASE
                    WHEN user_ai_projection.prompt_hash IS DISTINCT FROM EXCLUDED.prompt_hash
                    THEN 'cold'
                    ELSE user_ai_projection.status
                END,
                prompt_hash = EXCLUDED.prompt_hash
            "#,
            ai_projection_id,
            target_id,
            prompt_hash,
            ProjectionStatus::Cold.to_string(),
        )
        .execute(&self.pool)
        .await
        .map_err(sqlx_err)?;

        self.get_target_projection(ai_projection_id, target_id)
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_target_projection(
        &self,
        ai_projection_id: &str,
        target_id: &str,
    ) -> Result<UserAiProjection, AiProjectionError> {
        let row = sqlx::query!(
            r#"
            SELECT ai_projection_id, target_id, prompt_hash, status,
                   result, error, generated_at, stale_at
            FROM user_ai_projection
            WHERE ai_projection_id = $1 AND target_id = $2
            "#,
            ai_projection_id,
            target_id,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(sqlx_err)?;

        Ok(UserAiProjection {
            ai_projection_id: row.ai_projection_id,
            target_id: row.target_id,
            prompt_hash: row.prompt_hash,
            status: row.status.parse()?,
            result: row.result,
            error: row.error,
            generated_at: row.generated_at,
            stale_at: row.stale_at,
        })
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_projection(&self, id: &str) -> Result<AiProjection, AiProjectionError> {
        let row = sqlx::query!(
            r#"
            SELECT id, prompt, prompt_hash, target_type, refresh_cadence, expiry, model, output_schema, created_at, updated_at
            FROM ai_projection
            WHERE id = $1
            "#,
            id,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(sqlx_err)?;

        Ok(AiProjection {
            id: row.id,
            prompt: row.prompt,
            prompt_hash: row.prompt_hash,
            target_type: row.target_type.parse()?,
            refresh_cadence: row.refresh_cadence.parse()?,
            expiry: row.expiry.parse()?,
            model: row.model,
            output_schema: row.output_schema,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }

    #[tracing::instrument(skip(self), err)]
    async fn try_start_processing(
        &self,
        ai_projection_id: &str,
        target_id: &str,
    ) -> Result<bool, AiProjectionError> {
        // Reclaim claims left behind by crashed/stuck workers so they do not
        // block reprocessing forever. The threshold is a SQL literal because
        // `query!` binds parameters as typed values, not as an interval string.
        sqlx::query!(
            r#"
            DELETE FROM processing_ai_projections
            WHERE created_at < NOW() - INTERVAL '15 minutes'
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(sqlx_err)?;

        // Claim the pair. The composite primary key makes this atomic: only one
        // worker can insert the row, and `ON CONFLICT DO NOTHING` makes a losing
        // insert affect zero rows.
        let result = sqlx::query!(
            r#"
            INSERT INTO processing_ai_projections (ai_projection_id, target_id)
            VALUES ($1, $2)
            ON CONFLICT (ai_projection_id, target_id) DO NOTHING
            "#,
            ai_projection_id,
            target_id,
        )
        .execute(&self.pool)
        .await
        .map_err(sqlx_err)?;

        Ok(result.rows_affected() == 1)
    }

    #[tracing::instrument(skip(self), err)]
    async fn finish_processing(
        &self,
        ai_projection_id: &str,
        target_id: &str,
    ) -> Result<(), AiProjectionError> {
        sqlx::query!(
            r#"
            DELETE FROM processing_ai_projections
            WHERE ai_projection_id = $1 AND target_id = $2
            "#,
            ai_projection_id,
            target_id,
        )
        .execute(&self.pool)
        .await
        .map_err(sqlx_err)?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn set_projection_loading(
        &self,
        ai_projection_id: &str,
        target_id: &str,
        prompt_hash: &str,
    ) -> Result<(), AiProjectionError> {
        sqlx::query!(
            r#"
            UPDATE user_ai_projection
            SET status = $4, updated_at = NOW()
            WHERE ai_projection_id = $1 AND target_id = $2 AND prompt_hash = $3
            "#,
            ai_projection_id,
            target_id,
            prompt_hash,
            ProjectionStatus::Loading.to_string(),
        )
        .execute(&self.pool)
        .await
        .map_err(sqlx_err)?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn set_projection_refreshing(
        &self,
        ai_projection_id: &str,
        target_id: &str,
    ) -> Result<(), AiProjectionError> {
        sqlx::query!(
            r#"
            UPDATE user_ai_projection
            SET status = $3, updated_at = NOW()
            WHERE ai_projection_id = $1 AND target_id = $2
            "#,
            ai_projection_id,
            target_id,
            ProjectionStatus::Refreshing.to_string(),
        )
        .execute(&self.pool)
        .await
        .map_err(sqlx_err)?;

        Ok(())
    }

    #[tracing::instrument(skip(self, result), err)]
    async fn set_projection_result(
        &self,
        ai_projection_id: &str,
        target_id: &str,
        prompt_hash: &str,
        result: &str,
        generated_at: chrono::DateTime<chrono::Utc>,
        stale_at: chrono::DateTime<chrono::Utc>,
    ) -> Result<(), AiProjectionError> {
        sqlx::query!(
            r#"
            UPDATE user_ai_projection
            SET status = $4, result = $5, error = NULL,
                generated_at = $6, stale_at = $7, updated_at = NOW()
            WHERE ai_projection_id = $1 AND target_id = $2 AND prompt_hash = $3
            "#,
            ai_projection_id,
            target_id,
            prompt_hash,
            ProjectionStatus::Ready.to_string(),
            result,
            generated_at,
            stale_at,
        )
        .execute(&self.pool)
        .await
        .map_err(sqlx_err)?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn set_projection_error(
        &self,
        ai_projection_id: &str,
        target_id: &str,
        prompt_hash: &str,
        error: &str,
    ) -> Result<(), AiProjectionError> {
        sqlx::query!(
            r#"
            UPDATE user_ai_projection
            SET status = $4, error = $5, updated_at = NOW()
            WHERE ai_projection_id = $1 AND target_id = $2 AND prompt_hash = $3
            "#,
            ai_projection_id,
            target_id,
            prompt_hash,
            ProjectionStatus::Error.to_string(),
            error,
        )
        .execute(&self.pool)
        .await
        .map_err(sqlx_err)?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn user_has_permission(
        &self,
        user_id: &MacroUserIdStr<'_>,
        permission: &str,
    ) -> Result<bool, AiProjectionError> {
        let has_permission = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM "RolesOnUsers" ru
                JOIN "RolesOnPermissions" rp ON ru."roleId" = rp."roleId"
                WHERE ru."userId" = $1 AND rp."permissionId" = $2
            ) AS "has_permission!"
            "#,
            user_id.as_ref(),
            permission,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(sqlx_err)?;

        Ok(has_permission)
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_user_team_ids(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<uuid::Uuid>, AiProjectionError> {
        let team_ids = sqlx::query_scalar!(
            r#"
            SELECT team_id
            FROM team_user
            WHERE user_id = $1
            "#,
            user_id.as_ref(),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(sqlx_err)?;

        Ok(team_ids)
    }
}

/// Maps a [`sqlx::Error`] into an [`AiProjectionError`], surfacing missing rows
/// as [`AiProjectionError::NotFound`].
fn sqlx_err(e: sqlx::Error) -> AiProjectionError {
    match e {
        sqlx::Error::RowNotFound => AiProjectionError::NotFound,
        other => AiProjectionError::StorageLayerError(other.into()),
    }
}
