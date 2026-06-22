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
    #[tracing::instrument(skip(self), err)]
    async fn get_or_create_projection(
        &self,
        id: &str,
        prompt: &str,
        prompt_hash: &str,
        target_type: TargetType,
        refresh_cadence: RefreshCadence,
        expiry: Expiry,
    ) -> Result<AiProjection, AiProjectionError> {
        // Get-or-create: insert if absent, leave existing rows untouched, then
        // read back the canonical row.
        sqlx::query!(
            r#"
            INSERT INTO ai_projection (id, prompt, prompt_hash, target_type, refresh_cadence, expiry)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO NOTHING
            "#,
            id,
            prompt,
            prompt_hash,
            target_type.to_string(),
            refresh_cadence.to_string(),
            expiry.to_string(),
        )
        .execute(&self.pool)
        .await
        .map_err(sqlx_err)?;

        let row = sqlx::query!(
            r#"
            SELECT id, prompt, prompt_hash, target_type, refresh_cadence, expiry, created_at, updated_at
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
        let id = macro_uuid::generate_uuid_v7();

        sqlx::query!(
            r#"
            INSERT INTO user_ai_projection (id, ai_projection_id, target_id, prompt_hash, status)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (ai_projection_id, target_id, prompt_hash) DO NOTHING
            "#,
            id,
            ai_projection_id,
            target_id,
            prompt_hash,
            ProjectionStatus::Cold.to_string(),
        )
        .execute(&self.pool)
        .await
        .map_err(sqlx_err)?;

        let row = sqlx::query!(
            r#"
            SELECT id, ai_projection_id, target_id, prompt_hash, status,
                   result, error, generated_at, stale_at
            FROM user_ai_projection
            WHERE ai_projection_id = $1 AND target_id = $2 AND prompt_hash = $3
            "#,
            ai_projection_id,
            target_id,
            prompt_hash,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(sqlx_err)?;

        Ok(UserAiProjection {
            id: row.id,
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
