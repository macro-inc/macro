//! Service implementation for properties.

use std::fmt::Debug;

use models_properties::EntityType;
use models_properties::service::property_value::PropertyValue;
use system_properties::{StatusOption, SystemPropertyKey};
use uuid::Uuid;

use super::ports::PropertiesRepo;
use super::service::PropertiesService;

/// Implementation of PropertiesService using a repository.
#[derive(Debug)]
pub struct PropertiesServiceImpl<R>
where
    R: PropertiesRepo,
{
    repository: R,
}

impl<R> PropertiesServiceImpl<R>
where
    R: PropertiesRepo,
{
    /// Create a new PropertiesService.
    pub fn new(repository: R) -> Self {
        Self { repository }
    }
}

impl<R> PropertiesService for PropertiesServiceImpl<R>
where
    R: PropertiesRepo,
    R::Err: Debug,
{
    type Err = R::Err;

    #[tracing::instrument(skip(self), fields(entity_id = %entity_id, entity_type = ?entity_type))]
    async fn set_system_property_status_complete(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<(), Self::Err> {
        let status_property_id = SystemPropertyKey::STATUS_UUID;
        let completed_value = PropertyValue::SelectOption(vec![StatusOption::COMPLETED_UUID]);

        // Atomically update status to "Completed" if the property is attached
        self.repository
            .update_entity_property_value_if_exists(
                entity_id,
                entity_type,
                status_property_id,
                Some(completed_value),
            )
            .await?;

        Ok(())
    }

    #[tracing::instrument(skip(self))]
    async fn link_parent_task(
        &self,
        task_id: Uuid,
        parent_task_id: Option<Uuid>,
    ) -> Result<(), Self::Err> {
        self.repository
            .link_parent_task(task_id, parent_task_id)
            .await
    }

    #[tracing::instrument(skip(self))]
    async fn link_subtasks(&self, task_id: Uuid, subtask_ids: Vec<Uuid>) -> Result<(), Self::Err> {
        self.repository.link_subtasks(task_id, subtask_ids).await
    }
}
