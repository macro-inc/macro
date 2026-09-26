//! PostgreSQL storage for the typed columns of GitHub pull requests.

mod facets;
mod index;
mod listing;
#[cfg(test)]
mod test;

use sqlx::PgPool;

use crate::domain::{models::GithubPullRequestRow, ports::GithubPullRequestRepository};

/// Stores pull request rows in the `github_pull_request` table.
#[derive(Clone)]
pub struct PgGithubPullRequestRepo {
    pool: PgPool,
}

impl PgGithubPullRequestRepo {
    /// Create a repository over `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl GithubPullRequestRepository for PgGithubPullRequestRepo {
    type Err = sqlx::Error;

    #[tracing::instrument(err, skip(self))]
    async fn github_key_for(
        &self,
        repository_id: i64,
        number: i64,
    ) -> Result<Option<String>, Self::Err> {
        sqlx::query_scalar!(
            r#"
            SELECT github_key
            FROM github_pull_request
            WHERE repository_id = $1 AND number = $2
            "#,
            repository_id,
            number,
        )
        .fetch_optional(&self.pool)
        .await
    }

    #[tracing::instrument(err, skip(self, row), fields(github_key = %row.github_key))]
    async fn upsert_row(&self, row: &GithubPullRequestRow) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            INSERT INTO github_pull_request (
                github_key,
                repository_id,
                number,
                owner,
                repo,
                title,
                status,
                draft,
                author_github_user_id,
                author_login,
                requested_reviewer_github_user_ids,
                participant_github_user_ids,
                github_updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (github_key) DO UPDATE SET
                repository_id = COALESCE(EXCLUDED.repository_id, github_pull_request.repository_id),
                number = EXCLUDED.number,
                owner = EXCLUDED.owner,
                repo = EXCLUDED.repo,
                title = EXCLUDED.title,
                status = EXCLUDED.status,
                draft = EXCLUDED.draft,
                author_github_user_id = EXCLUDED.author_github_user_id,
                author_login = EXCLUDED.author_login,
                requested_reviewer_github_user_ids = EXCLUDED.requested_reviewer_github_user_ids,
                participant_github_user_ids = EXCLUDED.participant_github_user_ids,
                github_updated_at = EXCLUDED.github_updated_at,
                updated_at = NOW()
            "#,
            row.github_key,
            row.repository_id,
            row.number,
            row.owner,
            row.repo,
            row.title.as_deref(),
            row.status.map(|status| status.as_str()),
            row.draft,
            row.author_github_user_id.as_deref(),
            row.author_login.as_deref(),
            &row.requested_reviewer_github_user_ids,
            &row.participant_github_user_ids,
            row.github_updated_at,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn rename_row(&self, from: &str, to: &str) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            WITH taken AS (
                SELECT 1 FROM github_pull_request WHERE github_key = $2
            ),
            removed AS (
                DELETE FROM github_pull_request
                WHERE github_key = $1 AND EXISTS (SELECT 1 FROM taken)
            )
            UPDATE github_pull_request
            SET github_key = $2, updated_at = NOW()
            WHERE github_key = $1 AND NOT EXISTS (SELECT 1 FROM taken)
            "#,
            from,
            to,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}
