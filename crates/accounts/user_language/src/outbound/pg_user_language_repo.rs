//! PostgreSQL implementation of the [`UserLanguageRepo`] port.

#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;
use model_user::Language;
use sqlx::PgPool;

use crate::domain::ports::UserLanguageRepo;

/// PostgreSQL-backed user language repository, on the `"User"` table.
#[derive(Clone)]
pub struct PgUserLanguageRepo {
    pool: PgPool,
}

impl PgUserLanguageRepo {
    /// Create a repository backed by the given connection pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl UserLanguageRepo for PgUserLanguageRepo {
    type Err = sqlx::Error;

    #[tracing::instrument(err, skip_all)]
    async fn get_language(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<Option<Language>>, Self::Err> {
        sqlx::query!(
            r#"
            SELECT language as "language: Language"
            FROM "User"
            WHERE id = $1
            "#,
            user_id.as_ref(),
        )
        .map(|row| row.language)
        .fetch_optional(&self.pool)
        .await
    }

    #[tracing::instrument(err, skip_all)]
    async fn set_language(
        &self,
        user_id: &MacroUserIdStr<'_>,
        language: Option<Language>,
    ) -> Result<bool, Self::Err> {
        let result = sqlx::query!(
            r#"
            UPDATE "User"
            SET language = $2
            WHERE id = $1
            "#,
            user_id.as_ref(),
            language as Option<Language>,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }
}
