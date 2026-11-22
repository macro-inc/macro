//! Task dependency fanout through the existing properties read model.

use model_entity::{Entity, EntityType};
use properties::domain::task_dependency_state::TaskDependencyStateRepository;
use rootcause::Report;
use uuid::Uuid;

use crate::domain::ports::TaskDependencyNeighbors;

/// Reuses properties' indexed dependency reads without a second query path.
pub struct PropertiesTaskDependencyNeighbors<R>(pub R);

impl<R: TaskDependencyStateRepository> TaskDependencyNeighbors
    for PropertiesTaskDependencyNeighbors<R>
{
    #[tracing::instrument(skip_all, fields(task_count = task_ids.len()), err)]
    async fn neighbors(&self, task_ids: &[Uuid]) -> Result<Vec<Entity<'static>>, Report> {
        let ids = self
            .0
            .neighbors(task_ids)
            .await
            .map_err(|error| rootcause::report!(error))?;
        Ok(ids
            .into_iter()
            .map(|id| EntityType::Document.with_entity_string(id.to_string()))
            .collect())
    }
}
