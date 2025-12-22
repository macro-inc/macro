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

    /// Validate that the given option IDs exist for the property definition.
    /// Returns an error if any option ID is invalid.
    pub async fn validate_property_options(
        &self,
        property_definition_id: Uuid,
        option_ids: &[Uuid],
    ) -> anyhow::Result<()>
    where
        anyhow::Error: From<R::Err>,
    {
        if option_ids.is_empty() {
            return Ok(());
        }

        tracing::debug!(
            property_definition_id = %property_definition_id,
            option_ids = ?option_ids,
            "validating property options"
        );

        let valid_count = self
            .repository
            .count_valid_property_options(property_definition_id, option_ids)
            .await
            .map_err(anyhow::Error::from)?;

        if valid_count != option_ids.len() as i64 {
            anyhow::bail!(
                "Invalid property options: {} provided but only {} valid for property {}",
                option_ids.len(),
                valid_count,
                property_definition_id
            );
        }

        Ok(())
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

    #[tracing::instrument(skip(self), fields(entity_id = %entity_id, entity_type = ?entity_type, property_definition_id = %property_definition_id))]
    async fn get_property_value(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        property_definition_id: Uuid,
    ) -> Result<Option<PropertyValue>, Self::Err> {
        self.repository
            .get_entity_property_value(entity_id, entity_type, property_definition_id)
            .await
    }

    #[tracing::instrument(skip(self), fields(entity_id = %entity_id, entity_type = ?entity_type, property_key = ?property_key))]
    async fn get_system_property_value(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        property_key: SystemPropertyKey,
    ) -> Result<Option<PropertyValue>, Self::Err> {
        self.get_property_value(entity_id, entity_type, property_key.uuid())
            .await
    }
}
