//! Service implementation for properties.

mod helpers;
mod task_properties;

use models_properties::EntityType;
use models_properties::api::requests::SetPropertyValue;
use models_properties::convert_set_property_value_to_property_value;
use models_properties::service::property_value::PropertyValue;
use system_properties::{StatusOption, SystemPropertyKey};
use uuid::Uuid;

use super::error::PropertiesErr;
use super::ports::{PermissionService, PropertiesRepo};
use super::service::PropertiesService;

use helpers::{extract_option_ids_from_property_value, is_property_applicable_to};

/// Implementation of PropertiesService using a repository and optional permission service.
#[derive(Debug)]
pub struct PropertiesServiceImpl<R, P>
where
    R: PropertiesRepo,
    P: PermissionService,
{
    repository: R,
    permission_service: Option<P>,
}

impl<R, P> PropertiesServiceImpl<R, P>
where
    R: PropertiesRepo,
    P: PermissionService,
{
    /// Create a new PropertiesService with an optional permission service.
    pub fn new(repository: R, permission_service: Option<P>) -> Self {
        Self {
            repository,
            permission_service,
        }
    }

    /// Validate that the given option IDs exist for the property definition.
    /// Returns an error if any option ID is invalid.
    pub async fn validate_property_options(
        &self,
        property_definition_id: Uuid,
        option_ids: &[Uuid],
    ) -> Result<(), PropertiesErr>
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
            return Err(PropertiesErr::Validation(format!(
                "Invalid property options: {} provided but only {} valid for property {}",
                option_ids.len(),
                valid_count,
                property_definition_id
            )));
        }

        Ok(())
    }
}

impl<R, P> PropertiesService for PropertiesServiceImpl<R, P>
where
    R: PropertiesRepo,
    P: PermissionService,
    anyhow::Error: From<R::Err> + From<P::Err>,
{
    #[tracing::instrument(skip(self), fields(entity_id = %entity_id, entity_type = ?entity_type))]
    async fn set_system_property_status_complete(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<(), PropertiesErr> {
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
            .await
            .map_err(anyhow::Error::from)?;

        Ok(())
    }

    #[tracing::instrument(skip(self))]
    async fn link_parent_task(
        &self,
        task_id: Uuid,
        parent_task_id: Option<Uuid>,
    ) -> Result<(), PropertiesErr> {
        self.repository
            .link_parent_task(task_id, parent_task_id)
            .await
            .map_err(anyhow::Error::from)?;
        Ok(())
    }

    #[tracing::instrument(skip(self))]
    async fn link_subtasks(
        &self,
        task_id: Uuid,
        subtask_ids: Vec<Uuid>,
    ) -> Result<(), PropertiesErr> {
        self.repository
            .link_subtasks(task_id, subtask_ids)
            .await
            .map_err(anyhow::Error::from)?;
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(entity_id = %entity_id, entity_type = ?entity_type, property_definition_id = %property_definition_id))]
    async fn get_property_value(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        property_definition_id: Uuid,
    ) -> Result<Option<PropertyValue>, PropertiesErr> {
        Ok(self
            .repository
            .get_entity_property_value(entity_id, entity_type, property_definition_id)
            .await
            .map_err(anyhow::Error::from)?)
    }

    #[tracing::instrument(skip(self), fields(entity_id = %entity_id, entity_type = ?entity_type, property_key = ?property_key))]
    async fn get_system_property_value(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        property_key: SystemPropertyKey,
    ) -> Result<Option<PropertyValue>, PropertiesErr> {
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
    ) -> Result<(), PropertiesErr> {
        // Check edit permission first (permission service is required)
        let permission_service = self
            .permission_service
            .as_ref()
            .ok_or(PropertiesErr::PermissionDenied)?;
        permission_service
            .check_entity_edit_permission(user_id, entity_id, entity_type)
            .await
            .map_err(|_| PropertiesErr::PermissionDenied)?;

        // Get property definition to validate it exists and for validation
        let property_definition = self
            .repository
            .get_property_definition(property_definition_id)
            .await
            .map_err(anyhow::Error::from)?
            .ok_or_else(|| {
                PropertiesErr::Validation(format!(
                    "Property definition not found: {}",
                    property_definition_id
                ))
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
                    .map_err(|e| {
                        PropertiesErr::Validation(format!(
                            "Property value validation failed: {}",
                            e
                        ))
                    })?;

                // Convert SetPropertyValue to PropertyValue (JSONB format)
                Some(convert_set_property_value_to_property_value(set_value))
            }
            None => {
                tracing::debug!("no value provided, attaching property without value");
                None
            }
        };

        // Validate property options at service layer (before upserting)
        let option_ids = extract_option_ids_from_property_value(&property_value);
        if !option_ids.is_empty() {
            self.validate_property_options(property_definition_id, &option_ids)
                .await?;
        }

        // Check if this property can be attached to the given entity type
        if !is_property_applicable_to(property_definition_id, entity_type) {
            return Err(PropertiesErr::Validation(
                "This property cannot be attached to this entity type".to_string(),
            ));
        }

        // Handle special property types that require custom logic
        match property_definition_id {
            SystemPropertyKey::PARENT_TASK_UUID | SystemPropertyKey::SUBTASKS_UUID
                if entity_type == EntityType::Task =>
            {
                return self
                    .handle_task_relationship_property(entity_id, property_definition_id, value)
                    .await;
            }
            SystemPropertyKey::ASSIGNEES_UUID if entity_type == EntityType::Task => {
                self.handle_task_assignees_property(entity_id, value)
                    .await?;
            }
            _ => {
                // No special handling needed
            }
        }

        // For all properties (including those with special handling that don't return early),
        // upsert the already-converted PropertyValue
        self.repository
            .upsert_entity_property(
                entity_id,
                entity_type,
                property_definition_id,
                property_value,
            )
            .await
            .map_err(anyhow::Error::from)?;

        Ok(())
    }
}
