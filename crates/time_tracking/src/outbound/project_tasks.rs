//! A project's tasks for reports, from the tasks' Project system property.

use std::sync::Arc;

use system_properties::{SystemPropertiesService, SystemPropertyError};
use uuid::Uuid;

use crate::domain::ports::ProjectTasks;

/// [`ProjectTasks`] over the system properties service.
pub struct SystemPropertyProjectTasks<S>(Arc<S>);

impl<S> SystemPropertyProjectTasks<S> {
    /// Read projects' tasks through `service`.
    pub fn new(service: Arc<S>) -> Self {
        Self(service)
    }
}

impl<S: SystemPropertiesService> ProjectTasks for SystemPropertyProjectTasks<S> {
    type Err = SystemPropertyError;

    async fn project_task_ids(
        &self,
        project_id: Uuid,
        limit: u16,
    ) -> Result<Vec<String>, Self::Err> {
        self.0
            .project_task_ids(project_id, Some(u32::from(limit)))
            .await
    }
}
