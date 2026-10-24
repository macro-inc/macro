//! Installation claims read from MacroDB.

use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

use crate::domain::{models::GithubError, ports::GithubInstallationClaims};

#[cfg(test)]
mod test;

/// Reads `github_app_installation` and team membership in one query.
#[derive(Clone)]
pub struct PgGithubInstallationClaims {
    pool: PgPool,
}

impl PgGithubInstallationClaims {
    /// Create the adapter over the MacroDB pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl GithubInstallationClaims for PgGithubInstallationClaims {
    #[tracing::instrument(skip(self), err)]
    async fn has_claim(
        &self,
        user: &MacroUserIdStr<'_>,
        installation_id: u64,
    ) -> Result<bool, GithubError> {
        let claimed = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1 FROM github_app_installation i
                WHERE i.id = $1 AND (
                    (i.source_type = 'user' AND i.source_id = $2)
                    OR (i.source_type = 'team' AND EXISTS (
                        SELECT 1 FROM team_user t
                        WHERE t.team_id::text = i.source_id AND t.user_id = $2
                    ))
                )
            ) AS "claimed!"
            "#,
            installation_id.to_string(),
            user.as_ref(),
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|error| GithubError::Internal(error.into()))?;
        Ok(claimed)
    }
}
