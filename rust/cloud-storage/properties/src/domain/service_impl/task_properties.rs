//! Task-specific property handlers.

use models_properties::EntityType;
use models_properties::api::requests::SetPropertyValue;
use system_properties::SystemPropertyKey;
use uuid::Uuid;

use crate::domain::error::PropertiesErr;
use crate::domain::ports::{PermissionService, PropertiesRepo};
use crate::domain::service::PropertiesService;
use crate::domain::service_impl::PropertiesServiceImpl;

impl<R, P> PropertiesServiceImpl<R, P>
where
    R: PropertiesRepo,
    P: PermissionService,
    anyhow::Error: From<R::Err> + From<P::Err>,
{
    /// Handle task relationship properties (Parent Task / Subtasks) with bidirectional linking.
    /// Entity type is guaranteed to be Task (enforced by match guard).
    pub async fn handle_task_relationship_property(
        &self,
        entity_id: &str,
        property_definition_id: Uuid,
        value: Option<SetPropertyValue>,
    ) -> Result<(), PropertiesErr> {
        let task_id = Uuid::parse_str(entity_id)
            .map_err(|_| PropertiesErr::Validation("Invalid task ID".to_string()))?;

        match property_definition_id {
            SystemPropertyKey::PARENT_TASK_UUID => {
                // Extract parent task ID (None to clear)
                let parent_task_id = match &value {
                    None => None,
                    Some(SetPropertyValue::EntityReference { reference }) => {
                        if reference.entity_type != EntityType::Task {
                            return Err(PropertiesErr::Validation(
                                "Parent Task must reference a Task entity".to_string(),
                            ));
                        }
                        Some(Uuid::parse_str(&reference.entity_id).map_err(|_| {
                            PropertiesErr::Validation("Invalid task ID".to_string())
                        })?)
                    }
                    Some(_) => {
                        return Err(PropertiesErr::Validation(
                            "Parent Task requires a single entity reference".to_string(),
                        ));
                    }
                };

                PropertiesService::link_parent_task(self, task_id, parent_task_id).await?;
            }
            SystemPropertyKey::SUBTASKS_UUID => {
                // Extract subtask IDs (empty to clear)
                let subtask_ids = match &value {
                    None => vec![],
                    Some(SetPropertyValue::MultiEntityReference { references }) => {
                        let mut ids = Vec::with_capacity(references.len());
                        for ref_ in references {
                            if ref_.entity_type != EntityType::Task {
                                return Err(PropertiesErr::Validation(
                                    "Subtasks must reference Task entities".to_string(),
                                ));
                            }
                            ids.push(Uuid::parse_str(&ref_.entity_id).map_err(|_| {
                                PropertiesErr::Validation("Invalid task ID".to_string())
                            })?);
                        }
                        ids
                    }
                    Some(_) => {
                        return Err(PropertiesErr::Validation(
                            "Subtasks requires multiple entity references".to_string(),
                        ));
                    }
                };

                PropertiesService::link_subtasks(self, task_id, subtask_ids).await?;
            }
            _ => {
                // This should never happen due to the match guard, but handle it for completeness
                return Err(PropertiesErr::Validation(
                    "Invalid property for task relationship handling".to_string(),
                ));
            }
        }

        Ok(())
    }

    /// Handle task assignees property with permissions.
    /// Assignees is a multi-select entity property, so only accepts MultiEntityReference.
    /// If value is None (clearing assignees), there's nothing to do for permissions.
    pub async fn handle_task_assignees_property(
        &self,
        entity_id: &str,
        value: Option<SetPropertyValue>,
    ) -> Result<(), PropertiesErr> {
        // Clearing assignees - nothing to do for permissions
        let Some(SetPropertyValue::MultiEntityReference { references }) = &value else {
            if value.is_some() {
                // Assignees is multi-select, so only MultiEntityReference is valid
                // This should be caught by validate_compatibility, but handle it here for safety
                return Err(PropertiesErr::Validation(
                    "Assignees requires multiple entity references".to_string(),
                ));
            }
            return Ok(());
        };

        let assignee_ids: Vec<String> = references.iter().map(|r| r.entity_id.clone()).collect();
        if assignee_ids.is_empty() {
            return Ok(());
        }

        let task_id = Uuid::parse_str(entity_id)
            .map_err(|_| PropertiesErr::Validation("Invalid task ID".to_string()))?;

        self.handle_task_assignee_permissions(task_id, &assignee_ids)
            .await?;
        Ok(())
    }

    /// Handle permissions when task assignees are updated.
    /// Grants edit permissions to all assignees so they can edit the task.
    pub async fn handle_task_assignee_permissions(
        &self,
        task_id: Uuid,
        assignee_ids: &[String],
    ) -> Result<(), PropertiesErr> {
        if assignee_ids.is_empty() {
            return Ok(());
        }

        let permission_service = self
            .permission_service
            .as_ref()
            .ok_or(PropertiesErr::PermissionDenied)?;

        tracing::debug!(
            task_id = %task_id,
            assignee_count = assignee_ids.len(),
            "granting edit permissions to task assignees"
        );

        permission_service
            .grant_permissions_to_task(assignee_ids, &task_id.to_string())
            .await
            .map_err(anyhow::Error::from)
            .map_err(PropertiesErr::Repo)?;

        Ok(())
    }
}
