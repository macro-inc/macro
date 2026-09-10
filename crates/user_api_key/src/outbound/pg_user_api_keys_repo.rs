//! PostgreSQL implementation of the [`UserApiKeysRepo`] port.

#[cfg(test)]
mod tests;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{UserApiKey, UserApiKeyId, UserApiKeyInfo};
use crate::domain::ports::UserApiKeysRepo;

/// Postgres-backed user API key repository.
#[derive(Debug, Clone)]
pub struct PgUserApiKeysRepo {
    pool: PgPool,
}

impl PgUserApiKeysRepo {
    /// Create a repository backed by the provided pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// Errors produced by the Postgres user API key repository.
#[derive(Debug, thiserror::Error)]
pub enum UserApiKeysRepoErr {
    /// Underlying database error.
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    /// A stored owner is not a parseable macro user id.
    #[error("invalid user id stored for api key")]
    InvalidUserId,
}

struct UserApiKeyInfoRow {
    id: Uuid,
    name: String,
    created_at: DateTime<Utc>,
}

impl From<UserApiKeyInfoRow> for UserApiKeyInfo {
    fn from(row: UserApiKeyInfoRow) -> Self {
        Self {
            id: UserApiKeyId::from_uuid(row.id),
            name: row.name,
            created_at: row.created_at,
        }
    }
}

impl UserApiKeysRepo for PgUserApiKeysRepo {
    type Err = UserApiKeysRepoErr;

    #[tracing::instrument(err, skip_all)]
    async fn insert_key(
        &self,
        user_id: &MacroUserIdStr<'_>,
        id: UserApiKeyId,
        name: &str,
        hash: &[u8; 32],
    ) -> Result<UserApiKeyInfo, Self::Err> {
        let row = sqlx::query_as!(
            UserApiKeyInfoRow,
            r#"
            INSERT INTO "UserApiKey" (id, name, user_id, hash)
            VALUES ($1, $2, $3, $4)
            RETURNING id, name, created_at
            "#,
            id.as_uuid(),
            name,
            user_id.as_ref(),
            &hash[..],
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(row.into())
    }

    #[tracing::instrument(err, skip_all)]
    async fn count_keys(&self, user_id: &MacroUserIdStr<'_>) -> Result<i64, Self::Err> {
        let count = sqlx::query_scalar!(
            r#"SELECT COUNT(*) as "count!" FROM "UserApiKey" WHERE user_id = $1"#,
            user_id.as_ref(),
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(count)
    }

    #[tracing::instrument(err, skip_all)]
    async fn list_keys(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<UserApiKeyInfo>, Self::Err> {
        let rows = sqlx::query_as!(
            UserApiKeyInfoRow,
            r#"
            SELECT id, name, created_at
            FROM "UserApiKey"
            WHERE user_id = $1
            ORDER BY created_at DESC, id DESC
            "#,
            user_id.as_ref(),
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(UserApiKeyInfo::from).collect())
    }

    #[tracing::instrument(err, skip_all)]
    async fn delete_key(
        &self,
        user_id: &MacroUserIdStr<'_>,
        id: UserApiKeyId,
    ) -> Result<bool, Self::Err> {
        let result = sqlx::query!(
            r#"
            DELETE FROM "UserApiKey"
            WHERE user_id = $1 AND id = $2
            "#,
            user_id.as_ref(),
            id.as_uuid(),
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    #[tracing::instrument(err, skip_all)]
    async fn find_user_id_by_key(
        &self,
        key: &UserApiKey,
    ) -> Result<Option<MacroUserIdStr<'static>>, Self::Err> {
        let hash = key.hash();
        let row = sqlx::query!(
            r#"
            SELECT user_id
            FROM "UserApiKey"
            WHERE hash = $1
            "#,
            &hash[..],
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| {
            MacroUserIdStr::try_from(row.user_id).map_err(|_| UserApiKeysRepoErr::InvalidUserId)
        })
        .transpose()
    }
}
