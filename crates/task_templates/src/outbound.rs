//! Primary PostgreSQL persistence for task templates.
use crate::domain::{Repository, TaskTemplate, TaskTemplateConfiguration};
use sqlx::{PgPool, types::Json};
use uuid::Uuid;

/// Primary-backed template storage; the domain service owns authorization.
pub struct PgTaskTemplates(
    /// Primary database pool.
    pub PgPool,
);

/// PostgreSQL storage and typed-configuration encoding failures.
#[derive(Debug, thiserror::Error)]
pub enum PostgresError {
    /// A database read or write failed.
    #[error("task template database operation failed")]
    Database(#[from] sqlx::Error),
    /// Typed configuration could not be encoded as JSON.
    #[error("task template configuration encoding failed")]
    Serialization(#[from] serde_json::Error),
}

impl Repository for PgTaskTemplates {
    type Err = PostgresError;

    async fn list(&self, user: &str, team: Option<Uuid>) -> Result<Vec<TaskTemplate>, Self::Err> {
        let rows = sqlx::query!(
            r#"SELECT id, user_id, team_id, creator_id, name,
               configuration AS "configuration!: Json<TaskTemplateConfiguration>", revision,
               created_at, updated_at FROM task_template
               WHERE user_id = $1 OR team_id = $2
               ORDER BY created_at, id"#,
            user,
            team
        )
        .fetch_all(&self.0)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| TaskTemplate {
                id: row.id,
                user_id: row.user_id,
                team_id: row.team_id,
                creator_id: row.creator_id,
                name: row.name,
                configuration: row.configuration.0,
                revision: row.revision,
                created_at: row.created_at,
                updated_at: row.updated_at,
                can_manage: false,
            })
            .collect())
    }

    async fn get(&self, id: Uuid) -> Result<Option<TaskTemplate>, Self::Err> {
        let row = sqlx::query!(
            r#"SELECT id, user_id, team_id, creator_id, name,
               configuration AS "configuration!: Json<TaskTemplateConfiguration>", revision,
               created_at, updated_at FROM task_template WHERE id = $1"#,
            id
        )
        .fetch_optional(&self.0)
        .await?;
        Ok(row.map(|row| TaskTemplate {
            id: row.id,
            user_id: row.user_id,
            team_id: row.team_id,
            creator_id: row.creator_id,
            name: row.name,
            configuration: row.configuration.0,
            revision: row.revision,
            created_at: row.created_at,
            updated_at: row.updated_at,
            can_manage: false,
        }))
    }

    async fn create(&self, t: &TaskTemplate) -> Result<bool, Self::Err> {
        let configuration = serde_json::to_value(&t.configuration)?;
        Ok(sqlx::query!(
            "INSERT INTO task_template (id, user_id, team_id, creator_id, name, configuration)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO NOTHING",
            t.id,
            t.user_id,
            t.team_id,
            t.creator_id,
            t.name,
            configuration
        )
        .execute(&self.0)
        .await?
        .rows_affected()
            == 1)
    }

    async fn update(&self, t: &TaskTemplate, expected: i64) -> Result<bool, Self::Err> {
        let configuration = serde_json::to_value(&t.configuration)?;
        Ok(sqlx::query!(
            "UPDATE task_template SET name = $3, configuration = $4, revision = revision + 1, updated_at = now()
             WHERE id = $1 AND revision = $2",
            t.id, expected, t.name, configuration
        ).execute(&self.0).await?.rows_affected() == 1)
    }

    async fn delete(&self, t: &TaskTemplate, expected: i64) -> Result<bool, Self::Err> {
        Ok(sqlx::query!(
            "DELETE FROM task_template WHERE id = $1 AND revision = $2",
            t.id,
            expected
        )
        .execute(&self.0)
        .await?
        .rows_affected()
            == 1)
    }
}
