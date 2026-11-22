//! Authorized, batched facts about a task's dependency graph.

use std::collections::HashMap;
use uuid::Uuid;

use super::model::{PropertyAccessReceiptExt, ViewReceipt};

/// Dependency facts for one task. Identifiers never carry names or content.
#[derive(Clone, Debug, Default)]
pub struct TaskDependencyState {
    /// Task whose dependency graph is described.
    pub task_id: Uuid,
    /// Tasks that must complete first.
    pub blocker_ids: Vec<Uuid>,
    /// Tasks that depend on this task.
    pub dependent_ids: Vec<Uuid>,
    /// Existing, non-deleted blockers that have not completed.
    pub open_blocker_ids: Vec<Uuid>,
}

/// Indexed storage reads for dependency facts.
pub trait TaskDependencyStateRepository: Send + Sync + 'static {
    /// Find only endpoints for trusted background fanout; resolve each endpoint's audience separately.
    fn neighbors(
        &self,
        task_ids: &[Uuid],
    ) -> impl Future<Output = anyhow::Result<Vec<Uuid>>> + Send;
    /// Load facts for exactly the requested task identifiers.
    fn load(
        &self,
        task_ids: &[Uuid],
    ) -> impl Future<Output = anyhow::Result<Vec<TaskDependencyState>>> + Send;
}

/// Read task dependency facts after entity access has been established.
pub struct TaskDependencyStateService<R> {
    repository: R,
}

impl<R: TaskDependencyStateRepository> TaskDependencyStateService<R> {
    /// Construct the read service with the owning properties adapter.
    pub fn new(repository: R) -> Self {
        Self { repository }
    }

    /// Return dependency facts only for document view receipts.
    #[tracing::instrument(name = "tasks.dependencies.read", skip_all, fields(task_count = receipts.len()), err)]
    pub async fn load(
        &self,
        receipts: &[ViewReceipt],
    ) -> anyhow::Result<HashMap<Uuid, TaskDependencyState>> {
        let ids = receipts
            .iter()
            .filter(|receipt| {
                receipt.entity_type() == entity_access::domain::models::EntityType::Document
            })
            .filter_map(|receipt| Uuid::parse_str(receipt.entity_id()).ok())
            .collect::<Vec<_>>();
        let mut result = HashMap::new();
        for batch in ids.chunks(500) {
            result.extend(
                self.repository
                    .load(batch)
                    .await?
                    .into_iter()
                    .map(|state| (state.task_id, state)),
            );
        }
        Ok(result)
    }
}
