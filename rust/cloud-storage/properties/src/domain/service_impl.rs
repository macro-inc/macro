//! Service implementation for properties.

use std::fmt::Debug;

use models_properties::EntityType;
use models_properties::api::requests::SetPropertyValue;
use models_properties::convert_set_property_value_to_property_value;
use models_properties::service::property_value::PropertyValue;
use system_properties::{StatusOption, SystemPropertyKey};
use uuid::Uuid;

use super::ports::{PermissionChecker, PropertiesRepo};
use super::service::PropertiesService;

/// Implementation of PropertiesService using a repository and optional permission checker.
#[derive(Debug)]
pub struct PropertiesServiceImpl<R, P>
where
    R: PropertiesRepo,
    P: PermissionChecker,
{
    repository: R,
    permission_checker: Option<P>,
}

impl<R, P> PropertiesServiceImpl<R, P>
where
    R: PropertiesRepo,
    P: PermissionChecker,
{
    /// Create a new PropertiesService with an optional permission checker.
    pub fn new(repository: R, permission_checker: Option<P>) -> Self {
        Self {
            repository,
            permission_checker,
        }
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

    /// Extract option IDs from a PropertyValue (matches properties_db_client pattern).
    fn extract_option_ids_from_property_value(value: &Option<PropertyValue>) -> Vec<Uuid> {
        match value {
            Some(PropertyValue::SelectOption(ids)) => ids.clone(),
            _ => Vec::new(),
        }
    }

    /// Check if a property can be attached to the given entity type.
    fn is_property_applicable_to(property_id: Uuid, entity_type: EntityType) -> bool {
        // Task-only properties: Parent Task and Subtasks
        if property_id == SystemPropertyKey::PARENT_TASK_UUID
            || property_id == SystemPropertyKey::SUBTASKS_UUID
        {
            return entity_type == EntityType::Task;
        }

        true
    }
}

impl<R, P> PropertiesService for PropertiesServiceImpl<R, P>
where
    R: PropertiesRepo,
    P: PermissionChecker,
    R::Err: Debug + From<anyhow::Error> + From<P::Err>,
    anyhow::Error: From<R::Err>,
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

    #[tracing::instrument(
        skip(self),
        fields(
            entity_id = %entity_id,
            entity_type = ?entity_type,
            property_definition_id = %property_definition_id,
            has_value = value.is_some()
        )
    )]
    async fn set_entity_property(
        &self,
        user_id: &str,
        entity_id: &str,
        entity_type: EntityType,
        property_definition_id: Uuid,
        value: Option<SetPropertyValue>,
    ) -> Result<(), Self::Err> {
        // Check edit permission first (permission checker is required)
        let permission_checker = self.permission_checker.as_ref().ok_or_else(|| {
            anyhow::anyhow!("Permission checker is required for set_entity_property")
        })?;
        permission_checker
            .check_entity_edit_permission(user_id, entity_id, entity_type)
            .await
            .map_err(|e| R::Err::from(e))?;

        // Get property definition to validate it exists and for validation
        let property_definition = self
            .repository
            .get_property_definition(property_definition_id)
            .await?
            .ok_or_else(|| {
                anyhow::anyhow!("Property definition not found: {}", property_definition_id)
            })?;

        // Determine the value to set (if any) and validate
        let property_value = match &value {
            Some(set_value) => {
                // Validate that the request value is compatible with the property definition
                set_value
                    .validate_compatibility(
                        &property_definition.data_type,
                        property_definition.is_multi_select,
                    )
                    .map_err(|e| anyhow::anyhow!("Property value validation failed: {}", e))?;

                // Convert SetPropertyValue to PropertyValue (JSONB format)
                Some(convert_set_property_value_to_property_value(set_value))
            }
            None => {
                tracing::debug!("no value provided, attaching property without value");
                None
            }
        };

        // Validate property options at service layer (before upserting)
        let option_ids = Self::extract_option_ids_from_property_value(&property_value);
        if !option_ids.is_empty() {
            self.validate_property_options(property_definition_id, &option_ids)
                .await?;
        }

        // Check if this property can be attached to the given entity type
        if !Self::is_property_applicable_to(property_definition_id, entity_type) {
            return Err(
                anyhow::anyhow!("This property cannot be attached to this entity type").into(),
            );
        }

        // Handle bidirectional linking for task Parent Task / Subtasks properties
        // (if is_parent_or_subtask_property is true, entity_type is guaranteed to be Task by the earlier check)
        if property_definition_id == SystemPropertyKey::PARENT_TASK_UUID
            || property_definition_id == SystemPropertyKey::SUBTASKS_UUID
        {
            let task_id =
                Uuid::parse_str(entity_id).map_err(|_| anyhow::anyhow!("Invalid task ID"))?;

            if property_definition_id == SystemPropertyKey::PARENT_TASK_UUID {
                // Extract parent task ID (None to clear)
                let parent_task_id = match &value {
                    None => None,
                    Some(SetPropertyValue::EntityReference { reference }) => {
                        if reference.entity_type != EntityType::Task {
                            return Err(anyhow::anyhow!(
                                "Parent Task must reference a Task entity"
                            )
                            .into());
                        }
                        Some(
                            Uuid::parse_str(&reference.entity_id)
                                .map_err(|_| anyhow::anyhow!("Invalid task ID"))?,
                        )
                    }
                    Some(_) => {
                        return Err(anyhow::anyhow!(
                            "Parent Task requires a single entity reference"
                        )
                        .into());
                    }
                };

                self.link_parent_task(task_id, parent_task_id).await?;
            } else {
                // Extract subtask IDs (empty to clear)
                let subtask_ids = match &value {
                    None => vec![],
                    Some(SetPropertyValue::MultiEntityReference { references }) => {
                        let mut ids = Vec::with_capacity(references.len());
                        for ref_ in references {
                            if ref_.entity_type != EntityType::Task {
                                return Err(anyhow::anyhow!(
                                    "Subtasks must reference Task entities"
                                )
                                .into());
                            }
                            ids.push(
                                Uuid::parse_str(&ref_.entity_id)
                                    .map_err(|_| anyhow::anyhow!("Invalid task ID"))?,
                            );
                        }
                        ids
                    }
                    Some(_) => {
                        return Err(anyhow::anyhow!(
                            "Subtasks requires multiple entity references"
                        )
                        .into());
                    }
                };

                self.link_subtasks(task_id, subtask_ids).await?;
            }

            return Ok(());
        }

        // For all other properties, upsert the already-converted PropertyValue
        self.repository
            .upsert_entity_property(
                entity_id,
                entity_type,
                property_definition_id,
                property_value,
            )
            .await?;

        Ok(())
    }
}
