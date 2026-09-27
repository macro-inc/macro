//! Repository, author, assignee, and label counts over the pull requests a caller can see.

#[cfg(test)]
mod test;

use foreign_entity::domain::models::SourceId;

use super::PgGithubPullRequestRepo;
use crate::domain::{
    models::{
        GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE, GithubLabelFacet, GithubPullRequestFacets,
        GithubRepositoryFacet, GithubUserFacet,
    },
    ports::GithubPullRequestFacetRepository,
};

/// A pull request row is visible when one of its records is stored for one of the sources.
/// The records belong to the foreign_entity crate; these aggregates only read them.
impl GithubPullRequestFacetRepository for PgGithubPullRequestRepo {
    type Err = sqlx::Error;

    #[tracing::instrument(err, skip(self, source_ids))]
    async fn github_pull_request_facets(
        &self,
        source_ids: Vec<SourceId>,
    ) -> Result<GithubPullRequestFacets, Self::Err> {
        let (ids, auth_entities): (Vec<String>, Vec<String>) = source_ids
            .into_iter()
            .map(|source| (source.id, source.auth_entity))
            .unzip();

        let repositories = sqlx::query!(
            r#"
            WITH sources AS (
                SELECT DISTINCT id, auth_entity
                FROM UNNEST($1::text[], $2::text[]) AS source(id, auth_entity)
            )
            SELECT
                gpr.repository_id AS "repository_id!",
                (ARRAY_AGG(
                    gpr.owner || '/' || gpr.repo
                    ORDER BY COALESCE(gpr.github_updated_at, gpr.updated_at) DESC
                ))[1] AS "repository!",
                COUNT(*) AS "count!"
            FROM github_pull_request gpr
            WHERE gpr.repository_id IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM foreign_entity fe
                JOIN sources s
                  ON s.id = fe.stored_for_id AND s.auth_entity = fe.stored_for_auth_entity
                WHERE fe.foreign_entity_source = $3::text
                  AND fe.foreign_entity_id = gpr.github_key
              )
            GROUP BY gpr.repository_id
            ORDER BY COUNT(*) DESC, gpr.repository_id
            "#,
            &ids,
            &auth_entities,
            GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
        )
        .fetch_all(&self.pool)
        .await?;

        let authors = sqlx::query!(
            r#"
            WITH sources AS (
                SELECT DISTINCT id, auth_entity
                FROM UNNEST($1::text[], $2::text[]) AS source(id, auth_entity)
            )
            SELECT
                gpr.author_github_user_id AS "github_user_id!",
                (ARRAY_AGG(
                    gpr.author_login
                    ORDER BY COALESCE(gpr.github_updated_at, gpr.updated_at) DESC
                ) FILTER (WHERE gpr.author_login IS NOT NULL))[1] AS login,
                COUNT(*) AS "count!"
            FROM github_pull_request gpr
            WHERE gpr.author_github_user_id IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM foreign_entity fe
                JOIN sources s
                  ON s.id = fe.stored_for_id AND s.auth_entity = fe.stored_for_auth_entity
                WHERE fe.foreign_entity_source = $3::text
                  AND fe.foreign_entity_id = gpr.github_key
              )
            GROUP BY gpr.author_github_user_id
            ORDER BY COUNT(*) DESC, gpr.author_github_user_id
            "#,
            &ids,
            &auth_entities,
            GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
        )
        .fetch_all(&self.pool)
        .await?;

        let assignees = sqlx::query!(
            r#"
            WITH sources AS (
                SELECT DISTINCT id, auth_entity
                FROM UNNEST($1::text[], $2::text[]) AS source(id, auth_entity)
            )
            SELECT
                assignee.value ->> 'githubUserId' AS "github_user_id!",
                (ARRAY_AGG(
                    assignee.value ->> 'login'
                    ORDER BY COALESCE(gpr.github_updated_at, gpr.updated_at) DESC
                ) FILTER (WHERE assignee.value ->> 'login' IS NOT NULL))[1] AS login,
                COUNT(*) AS "count!"
            FROM github_pull_request gpr
            CROSS JOIN LATERAL jsonb_array_elements(gpr.assignees) AS assignee(value)
            WHERE assignee.value ->> 'githubUserId' IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM foreign_entity fe
                JOIN sources s
                  ON s.id = fe.stored_for_id AND s.auth_entity = fe.stored_for_auth_entity
                WHERE fe.foreign_entity_source = $3::text
                  AND fe.foreign_entity_id = gpr.github_key
              )
            GROUP BY assignee.value ->> 'githubUserId'
            ORDER BY COUNT(*) DESC, assignee.value ->> 'githubUserId'
            "#,
            &ids,
            &auth_entities,
            GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
        )
        .fetch_all(&self.pool)
        .await?;

        let labels = sqlx::query!(
            r#"
            WITH sources AS (
                SELECT DISTINCT id, auth_entity
                FROM UNNEST($1::text[], $2::text[]) AS source(id, auth_entity)
            )
            SELECT
                label.value ->> 'name' AS "name!",
                (ARRAY_AGG(
                    label.value ->> 'color'
                    ORDER BY COALESCE(gpr.github_updated_at, gpr.updated_at) DESC
                ) FILTER (WHERE label.value ->> 'color' IS NOT NULL))[1] AS color,
                COUNT(*) AS "count!"
            FROM github_pull_request gpr
            CROSS JOIN LATERAL jsonb_array_elements(gpr.labels) AS label(value)
            WHERE label.value ->> 'name' IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM foreign_entity fe
                JOIN sources s
                  ON s.id = fe.stored_for_id AND s.auth_entity = fe.stored_for_auth_entity
                WHERE fe.foreign_entity_source = $3::text
                  AND fe.foreign_entity_id = gpr.github_key
              )
            GROUP BY label.value ->> 'name'
            ORDER BY COUNT(*) DESC, label.value ->> 'name'
            "#,
            &ids,
            &auth_entities,
            GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(GithubPullRequestFacets {
            repositories: repositories
                .into_iter()
                .map(|row| GithubRepositoryFacet {
                    repository_id: row.repository_id.to_string(),
                    repository: row.repository,
                    count: row.count,
                })
                .collect(),
            authors: authors
                .into_iter()
                .map(|row| GithubUserFacet {
                    github_user_id: row.github_user_id,
                    login: row.login,
                    count: row.count,
                })
                .collect(),
            assignees: assignees
                .into_iter()
                .map(|row| GithubUserFacet {
                    github_user_id: row.github_user_id,
                    login: row.login,
                    count: row.count,
                })
                .collect(),
            labels: labels
                .into_iter()
                .map(|row| GithubLabelFacet {
                    name: row.name,
                    color: row.color,
                    count: row.count,
                })
                .collect(),
        })
    }
}
