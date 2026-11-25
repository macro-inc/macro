//! PostgreSQL reads for bounded task dependency batches.

#[cfg(test)]
mod test;

use crate::domain::task_dependency_state::{TaskDependencyState, TaskDependencyStateRepository};
use sqlx::{PgPool, postgres::PgPoolOptions};
use uuid::Uuid;

/// Adapter for the dependency graph's indexed, batched read model.
pub struct PgTaskDependencyStateRepository {
    pool: PgPool,
    neighbor_pool: PgPool,
}

impl PgTaskDependencyStateRepository {
    /// Keep ordinary reads on the application pool and cap fanout at two extra connections.
    /// Startup options establish the server deadline before any neighbor statement starts.
    pub fn new(pool: PgPool) -> Self {
        let options = (*pool.connect_options())
            .clone()
            .options([("statement_timeout", "10s")]);
        let neighbor_pool = PgPoolOptions::new()
            .max_connections(2)
            .min_connections(0)
            .test_before_acquire(false)
            .connect_lazy_with(options);
        Self {
            pool,
            neighbor_pool,
        }
    }
}

impl TaskDependencyStateRepository for PgTaskDependencyStateRepository {
    #[tracing::instrument(name = "tasks.dependencies.neighbors", skip_all, fields(task_count = task_ids.len()), err)]
    async fn neighbors(
        &self,
        task_ids: &[Uuid],
        only_task_roots: bool,
    ) -> anyhow::Result<Vec<Uuid>> {
        // The scalar primary-key lookup stays per root in generic plans too.
        // A missing subtype yields NULL and cannot qualify an Updated root.
        let ids = sqlx::query_scalar!(r#"SELECT neighbor.id AS "id!" FROM unnest($1::uuid[]) requested(task_id)
            CROSS JOIN LATERAL (
                SELECT blocker_task_id AS id FROM task_dependency_edges WHERE dependent_task_id = requested.task_id
                UNION ALL
                SELECT dependent_task_id AS id FROM task_dependency_edges WHERE blocker_task_id = requested.task_id
            ) neighbor
            WHERE NOT $2 OR (
                SELECT sub_type = 'task' FROM document_sub_type
                WHERE document_id = requested.task_id::text
            )"#, task_ids, only_task_roots).fetch_all(&self.neighbor_pool).await?;
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
