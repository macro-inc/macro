//! PostgreSQL implementation of the [`GithubSyncRepo`] port.

#[cfg(test)]
mod test;

use std::collections::HashSet;

use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

use crate::domain::{
    models::{GithubAppInstallationSource, GithubKey, MacroTaskId, TeamTaskReference},
    ports::GithubSyncRepo,
};

/// PostgreSQL-backed github repository.
#[derive(Clone)]
pub struct PgGithubSyncRepo {
    pool: PgPool,
}

impl PgGithubSyncRepo {
    /// Create a new repository backed by the given connection pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl GithubSyncRepo for PgGithubSyncRepo {
    type Err = sqlx::Error;

    #[tracing::instrument(skip(self), err)]
    async fn get_task_ids(&self, github_key: GithubKey) -> Result<Vec<MacroTaskId>, Self::Err> {
        let task_ids: Vec<String> = sqlx::query!(
            r#"
            SELECT task_id FROM github_pr_tasks
            WHERE github_key = $1
            "#,
            github_key.as_ref(),
        )
        .map(|r| r.task_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(task_ids
            .into_iter()
            .filter_map(|t| MacroTaskId::from_short_uuid(&t))
            .collect())
    }

    #[tracing::instrument(skip(self), err)]
    async fn upsert_task_ids(
        &self,
        github_key: GithubKey,
        task_ids: &[MacroTaskId],
    ) -> Result<(), Self::Err> {
        let short_ids: Vec<String> = task_ids.iter().map(|t| t.short_uuid.clone()).collect();
        let ids: Vec<uuid::Uuid> = short_ids
            .iter()
            .map(|_| macro_uuid::generate_uuid_v7())
            .collect();
        let github_key = github_key.as_ref();
        let github_keys: Vec<&str> = std::iter::repeat_n(github_key, short_ids.len()).collect();

        sqlx::query!(
            r#"
        INSERT INTO github_pr_tasks (id, github_key, task_id)
        SELECT * FROM UNNEST($1::uuid[], $2::text[], $3::text[])
        ON CONFLICT (github_key, task_id) DO NOTHING
        "#,
            &ids,
            &github_keys as &[&str],
            &short_ids
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn filter_duplicate_tasks(
        &self,
        github_key: GithubKey,
        task_ids: &[MacroTaskId],
    ) -> Result<Vec<MacroTaskId>, Self::Err> {
        let short_ids: Vec<String> = task_ids.iter().map(|t| t.short_uuid.clone()).collect();

        let existing: Vec<String> = sqlx::query_scalar!(
            r#"
        SELECT task_id
        FROM github_pr_tasks
        WHERE github_key = $1
          AND task_id = ANY($2::text[])
        "#,
            github_key.as_ref(),
            &short_ids
        )
        .fetch_all(&self.pool)
        .await?;

        let existing_set: HashSet<String> = existing.into_iter().collect();

        Ok(task_ids
            .iter()
            .filter(|t| !existing_set.contains(&t.short_uuid))
            .cloned()
            .collect())
    }

    #[tracing::instrument(skip(self, references), err)]
    async fn resolve_team_task_references(
        &self,
        installation_id: &str,
        references: &[TeamTaskReference],
    ) -> Result<Vec<MacroTaskId>, Self::Err> {
        if references.is_empty() {
            return Ok(Vec::new());
        }

        let team_slugs: Vec<String> = references.iter().map(|r| r.team_slug.clone()).collect();
        let team_task_ids: Vec<i32> = references.iter().map(|r| r.team_task_id).collect();

        let rows = sqlx::query!(
            r#"
            SELECT DISTINCT tt.document_id
            FROM UNNEST($2::text[], $3::int4[]) AS refs(team_slug, task_num)
            JOIN github_app_installation gai
                ON gai.id = $1
                AND gai.source_type = 'team'::github_app_installation_source_type
            JOIN team t
                ON t.id = gai.source_id::uuid
                AND LOWER(t.slug) = LOWER(refs.team_slug)
            JOIN team_task tt ON tt.team_id = t.id AND tt.task_num = refs.task_num
            "#,
            installation_id,
            &team_slugs,
            &team_task_ids
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let document_id = row.document_id;
                match uuid::Uuid::parse_str(&document_id) {
                    Ok(uuid) => Some(MacroTaskId::from_uuid(&uuid)),
                    Err(e) => {
                        tracing::warn!(
                            document_id,
                            error=?e,
                            "team task document id is not a UUID"
                        );
                        None
                    }
                }
            })
            .collect())
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_macro_id_by_github_user_id(
        &self,
        github_user_id: &str,
    ) -> Result<Option<String>, Self::Err> {
        let macro_id = sqlx::query_scalar!(
            r#"
            SELECT macro_id
            FROM github_links
            WHERE github_user_id = $1
            "#,
            github_user_id,
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(macro_id)
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_user_team_ids(&self, macro_id: &str) -> Result<Vec<uuid::Uuid>, Self::Err> {
        let team_ids = sqlx::query_scalar!(
            r#"
            SELECT team_id
            FROM team_user
            WHERE user_id = $1
            "#,
            macro_id,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(team_ids)
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_team_member_ids(
        &self,
        team_id: uuid::Uuid,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Self::Err> {
        let user_ids: Vec<String> = sqlx::query_scalar!(
            r#"
            SELECT user_id
            FROM team_user
            WHERE team_id = $1
            ORDER BY user_id
            "#,
            team_id,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(user_ids
            .into_iter()
            .filter_map(|user_id| match MacroUserIdStr::try_from(user_id.clone()) {
                Ok(user_id) => Some(user_id),
                Err(error) => {
                    tracing::warn!(
                        team_id=%team_id,
                        user_id,
                        error=?error,
                        "team_user.user_id is not a Macro user ID"
                    );
                    None
                }
            })
            .collect())
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_installation_sources(
        &self,
        installation_id: &str,
    ) -> Result<Vec<GithubAppInstallationSource>, Self::Err> {
        let rows = sqlx::query!(
            r#"
            SELECT source_id AS "source_id!", source_type::text AS "source_type!"
            FROM github_app_installation
            WHERE id = $1
            ORDER BY source_type, source_id
            "#,
            installation_id,
        )
        .fetch_all(&self.pool)
        .await?;

        let mut sources = Vec::new();
        for row in rows {
            let source_id = row.source_id;
            let source_type = row.source_type;
            match source_type.as_str() {
                "team" => match uuid::Uuid::parse_str(&source_id) {
                    Ok(team_id) => sources.push(GithubAppInstallationSource::Team(team_id)),
                    Err(error) => tracing::warn!(
                        installation_id,
                        source_id,
                        error=?error,
                        "github_app_installation team source_id is not a UUID"
                    ),
                },
                "user" => sources.push(GithubAppInstallationSource::User(source_id)),
                _ => tracing::warn!(
                    installation_id,
                    source_id,
                    source_type,
                    "github_app_installation has unknown source_type"
                ),
            }
        }

        Ok(sources)
    }

    #[tracing::instrument(skip(self), err)]
    async fn upsert_installation_sources(
        &self,
        installation_id: &str,
        sources: &[GithubAppInstallationSource],
    ) -> Result<(), Self::Err> {
        let source_ids: Vec<String> = sources.iter().map(|source| source.source_id()).collect();
        let source_types: Vec<&str> = sources.iter().map(|source| source.source_type()).collect();

        sqlx::query!(
            r#"
            INSERT INTO github_app_installation (id, source_id, source_type)
            SELECT $1::text, source_id, source_type::github_app_installation_source_type
            FROM UNNEST($2::text[], $3::text[])
                AS source_rows(source_id, source_type)
            ON CONFLICT (id, source_id, source_type) DO NOTHING
            "#,
            installation_id,
            &source_ids,
            &source_types as &[&str],
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}
