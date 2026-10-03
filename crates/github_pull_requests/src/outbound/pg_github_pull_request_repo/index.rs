//! The stored pull request records the indexer writes rows from.

#[cfg(test)]
mod test;

use super::PgGithubPullRequestRepo;
use crate::domain::{
    models::GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE, ports::GithubPullRequestIndexRepository,
};

/// The records belong to the foreign_entity crate; the indexer only reads them.
impl GithubPullRequestIndexRepository for PgGithubPullRequestRepo {
    type Err = sqlx::Error;

    #[tracing::instrument(err, skip(self))]
    async fn latest_pull_request_metadata(
        &self,
        owner: &str,
        name: &str,
    ) -> Result<Vec<serde_json::Value>, Self::Err> {
        let key_prefix = format!("{owner}/{name}/pull/");
        sqlx::query_scalar!(
            r#"
            SELECT DISTINCT ON (fe.foreign_entity_id) fe.metadata AS "metadata!: serde_json::Value"
            FROM foreign_entity fe
            WHERE fe.foreign_entity_source = $1::text
              AND left(lower(fe.foreign_entity_id), length($2::text)) = lower($2::text)
            ORDER BY fe.foreign_entity_id, fe.updated_at DESC, fe.id DESC
            "#,
            GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
            key_prefix,
        )
        .fetch_all(&self.pool)
        .await
    }
}
