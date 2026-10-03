//! PostgreSQL storage for the typed columns of GitHub pull requests.

mod changesets;
mod facets;
mod index;
mod listing;
#[cfg(test)]
mod test;

use sqlx::PgPool;

use crate::domain::{
    models::{GitRef, GithubPullRequestRow, GithubPullRequestStatus, GithubPullRequestWrite},
    ports::GithubPullRequestRepository,
};

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

    #[tracing::instrument(err, skip(self, update), fields(github_key = %update.github_key))]
    async fn upsert_row(&self, update: &GithubPullRequestWrite) -> Result<(), Self::Err> {
        let mut tx = self.pool.begin().await?;
        // Lock the key before reading, including when no row exists yet.
        sqlx::query!(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            update.github_key
        )
        .execute(&mut *tx)
        .await?;
        let stored = sqlx::query!(
            r#"SELECT github_key, repository_id, number, owner, repo, title, status,
                      draft, author_github_user_id, author_login,
                      requested_reviewer_github_user_ids, participant_github_user_ids,
                      github_updated_at, assignees, labels, reviews,
                      base_ref, base_sha, head_ref, head_sha
               FROM github_pull_request WHERE github_key = $1 FOR UPDATE"#,
            update.github_key,
        )
        .fetch_optional(&mut *tx)
        .await?;
        let decode = |value: serde_json::Value| {
            serde_json::from_value(value).map_err(|error| sqlx::Error::Decode(error.into()))
        };
        let existing = stored
            .map(|stored| -> Result<GithubPullRequestRow, sqlx::Error> {
                let status = stored
                    .status
                    .map(|status| {
                        serde_json::from_value::<GithubPullRequestStatus>(
                            serde_json::Value::String(status),
                        )
                        .map_err(|error| sqlx::Error::Decode(error.into()))
                    })
                    .transpose()?;
                let reviews: Vec<crate::domain::models::GithubPullRequestReview> =
                    decode(stored.reviews)?;
                let requested_reviewer_github_user_ids = stored.requested_reviewer_github_user_ids;
                let review_decision =
                    crate::domain::models::GithubPullRequestReviewDecision::derive(
                        &reviews,
                        &requested_reviewer_github_user_ids,
                    );
                Ok(GithubPullRequestRow {
                    github_key: stored.github_key,
                    repository_id: stored.repository_id,
                    number: stored.number,
                    owner: stored.owner,
                    repo: stored.repo,
                    title: stored.title,
                    status,
                    draft: stored.draft,
                    author_github_user_id: stored.author_github_user_id,
                    author_login: stored.author_login,
                    requested_reviewer_github_user_ids,
                    participant_github_user_ids: stored.participant_github_user_ids,
                    github_updated_at: stored.github_updated_at,
                    assignees: serde_json::from_value(stored.assignees)
                        .map_err(|error| sqlx::Error::Decode(error.into()))?,
                    labels: serde_json::from_value(stored.labels)
                        .map_err(|error| sqlx::Error::Decode(error.into()))?,
                    reviews,
                    review_decision,
                    base: (stored.base_ref.is_some() || stored.base_sha.is_some()).then_some(
                        GitRef {
                            name: stored.base_ref,
                            sha: stored.base_sha,
                        },
                    ),
                    head: (stored.head_ref.is_some() || stored.head_sha.is_some()).then_some(
                        GitRef {
                            name: stored.head_ref,
                            sha: stored.head_sha,
                        },
                    ),
                })
            })
            .transpose()?;
        let row = update.merge(existing);
        let json = |value: serde_json::Result<serde_json::Value>| {
            value.map_err(|error| sqlx::Error::Encode(error.into()))
        };
        let assignees = json(serde_json::to_value(&row.assignees))?;
        let labels = json(serde_json::to_value(&row.labels))?;
        let reviews = json(serde_json::to_value(&row.reviews))?;
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
                github_updated_at,
                assignees,
                labels,
                reviews,
                review_decision,
                base_ref,
                base_sha,
                head_ref,
                head_sha
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                $14::jsonb, $15::jsonb, $16::jsonb, $17, $18, $19, $20, $21
            )
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
                assignees = EXCLUDED.assignees,
                labels = EXCLUDED.labels,
                reviews = EXCLUDED.reviews,
                review_decision = EXCLUDED.review_decision,
                base_ref = CASE WHEN $22::bool THEN EXCLUDED.base_ref ELSE github_pull_request.base_ref END,
                base_sha = CASE WHEN $22::bool THEN EXCLUDED.base_sha ELSE github_pull_request.base_sha END,
                head_ref = CASE WHEN $23::bool THEN EXCLUDED.head_ref ELSE github_pull_request.head_ref END,
                head_sha = CASE WHEN $23::bool THEN EXCLUDED.head_sha ELSE github_pull_request.head_sha END,
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
            assignees,
            labels,
            reviews,
            row.review_decision.map(|decision| decision.as_str()),
            row.base.as_ref().and_then(|base| base.name.as_deref()),
            row.base.as_ref().and_then(|base| base.sha.as_deref()),
            row.head.as_ref().and_then(|head| head.name.as_deref()),
            row.head.as_ref().and_then(|head| head.sha.as_deref()),
            row.base.is_some(),
            row.head.is_some(),
        )
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
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

    #[tracing::instrument(err, skip(self))]
    async fn pull_request_row(
        &self,
        github_key: &str,
    ) -> Result<Option<GithubPullRequestRow>, Self::Err> {
        let Some(row) = sqlx::query!(
            r#"
            SELECT
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
                github_updated_at,
                assignees,
                labels,
                reviews,
                review_decision,
                base_ref,
                base_sha,
                head_ref,
                head_sha
            FROM github_pull_request
            WHERE github_key = $1
            "#,
            github_key,
        )
        .fetch_optional(&self.pool)
        .await?
        else {
            return Ok(None);
        };

        Ok(Some(GithubPullRequestRow {
            github_key: row.github_key,
            repository_id: row.repository_id,
            number: row.number,
            owner: row.owner,
            repo: row.repo,
            title: row.title,
            status: row
                .status
                .map(|status| decode(serde_json::Value::String(status)))
                .transpose()?,
            draft: row.draft,
            author_github_user_id: row.author_github_user_id,
            author_login: row.author_login,
            requested_reviewer_github_user_ids: row.requested_reviewer_github_user_ids,
            participant_github_user_ids: row.participant_github_user_ids,
            github_updated_at: row.github_updated_at,
            assignees: decode(row.assignees)?,
            labels: decode(row.labels)?,
            reviews: decode(row.reviews)?,
            review_decision: row
                .review_decision
                .map(|decision| decode(serde_json::Value::String(decision)))
                .transpose()?,
            base: git_ref(row.base_ref, row.base_sha),
            head: git_ref(row.head_ref, row.head_sha),
        }))
    }
}

fn git_ref(name: Option<String>, sha: Option<String>) -> Option<GitRef> {
    (name.is_some() || sha.is_some()).then_some(GitRef { name, sha })
}

fn decode<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> Result<T, sqlx::Error> {
    serde_json::from_value(value).map_err(|error| sqlx::Error::Decode(error.into()))
}
