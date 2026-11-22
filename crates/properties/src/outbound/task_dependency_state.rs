//! PostgreSQL reads for bounded task dependency batches.

#[cfg(test)]
mod test;

use crate::domain::task_dependency_state::{TaskDependencyState, TaskDependencyStateRepository};
use sqlx::PgPool;
use uuid::Uuid;

/// Adapter for the dependency graph's indexed, batched read model.
pub struct PgTaskDependencyStateRepository {
    pool: PgPool,
}

impl PgTaskDependencyStateRepository {
    /// Use the application's existing MacroDB pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl TaskDependencyStateRepository for PgTaskDependencyStateRepository {
    #[tracing::instrument(name = "tasks.dependencies.neighbors", skip_all, fields(task_count = task_ids.len()), err)]
    async fn neighbors(&self, task_ids: &[Uuid]) -> anyhow::Result<Vec<Uuid>> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '10s'")
            .execute(&mut *transaction)
            .await?;
        let ids = sqlx::query_scalar!(r#"SELECT neighbor.id AS "id!" FROM unnest($1::uuid[]) requested(task_id)
            CROSS JOIN LATERAL (
                SELECT blocker_task_id AS id FROM task_dependency_edges WHERE dependent_task_id = requested.task_id
                UNION ALL
                SELECT dependent_task_id AS id FROM task_dependency_edges WHERE blocker_task_id = requested.task_id
            ) neighbor"#, task_ids).fetch_all(&mut *transaction).await?;
        transaction.commit().await?;
        Ok(ids)
    }
    #[tracing::instrument(name = "tasks.dependencies.query", skip_all, fields(task_count = task_ids.len()), err)]
    async fn load(&self, task_ids: &[Uuid]) -> anyhow::Result<Vec<TaskDependencyState>> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '10s'")
            .execute(&mut *transaction)
            .await?;
        let rows = sqlx::query_as!(TaskDependencyState,
            r#"SELECT requested.task_id AS "task_id!",
                ARRAY(SELECT blocker_task_id FROM task_dependency_edges
                    WHERE dependent_task_id = requested.task_id ORDER BY blocker_task_id) AS "blocker_ids!",
                ARRAY(SELECT dependent_task_id FROM task_dependency_edges
                    WHERE blocker_task_id = requested.task_id ORDER BY dependent_task_id) AS "dependent_ids!",
                ARRAY(SELECT blocker_id FROM task_open_blockers(ARRAY[requested.task_id])
                    ORDER BY blocker_id) AS "open_blocker_ids!"
               FROM unnest($1::uuid[]) requested(task_id)"#,
            task_ids
        ).fetch_all(&mut *transaction).await?;
        transaction.commit().await?;
        Ok(rows)
    }
}
