//! PostgreSQL implementation of the [`GithubSyncRepo`] port.

#[cfg(test)]
mod test;

use std::collections::HashSet;

use sqlx::PgPool;

use crate::domain::{
    models::{GithubKey, MacroTaskId},
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
    async fn insert_installation_team_associations(
        &self,
        installation_id: &str,
        team_ids: &[uuid::Uuid],
        installed_by: &str,
    ) -> Result<(), Self::Err> {
        let installation_ids: Vec<&str> =
            std::iter::repeat_n(installation_id, team_ids.len()).collect();
        let installed_bys: Vec<&str> = std::iter::repeat_n(installed_by, team_ids.len()).collect();

        sqlx::query!(
            r#"
            INSERT INTO github_app_installation_team (id, team_id, installed_by)
            SELECT * FROM UNNEST($1::text[], $2::uuid[], $3::text[])
            ON CONFLICT (id, team_id) DO NOTHING
            "#,
            &installation_ids as &[&str],
            team_ids,
            &installed_bys as &[&str],
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}
