//! PostgreSQL implementation of the [`UserApiKeysRepo`] port.

#[cfg(test)]
mod tests;

use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

use crate::domain::models::UserApiKey;
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

impl UserApiKeysRepo for PgUserApiKeysRepo {
    type Err = UserApiKeysRepoErr;

    #[tracing::instrument(err, skip_all)]
    async fn insert_key(
        &self,
        user_id: &MacroUserIdStr<'_>,
        key: &UserApiKey,
    ) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            INSERT INTO "UserApiKey" (user_id, key)
            VALUES ($1, $2)
            "#,
            user_id.as_ref(),
            key.expose(),
        )
        .execute(&self.pool)
        .await?;
        Ok(())
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
    async fn list_keys(&self, user_id: &MacroUserIdStr<'_>) -> Result<Vec<UserApiKey>, Self::Err> {
        let rows = sqlx::query!(
            r#"
            SELECT key
            FROM "UserApiKey"
            WHERE user_id = $1
            ORDER BY key
            "#,
            user_id.as_ref(),
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| UserApiKey::from_raw(row.key))
            .collect())
    }

    #[tracing::instrument(err, skip_all)]
    async fn delete_key(
        &self,
        user_id: &MacroUserIdStr<'_>,
        key: &UserApiKey,
    ) -> Result<bool, Self::Err> {
        let result = sqlx::query!(
            r#"
            DELETE FROM "UserApiKey"
            WHERE user_id = $1 AND key = $2
            "#,
            user_id.as_ref(),
            key.expose(),
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
        let row = sqlx::query!(
            r#"
            SELECT user_id
            FROM "UserApiKey"
            WHERE key = $1
            "#,
            key.expose(),
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| {
            MacroUserIdStr::try_from(row.user_id).map_err(|_| UserApiKeysRepoErr::InvalidUserId)
        })
        .transpose()
    }
}
