//! Task-specific property handlers.

use models_properties::EntityType;
use models_properties::api::requests::SetPropertyValue;
use system_properties::SystemPropertyKey;
use uuid::Uuid;

use crate::domain::error::PropertiesErr;
use crate::domain::ports::{NotificationService, PermissionService, PropertiesRepo};
use crate::domain::service::PropertiesService;
use crate::domain::service_impl::PropertiesServiceImpl;

impl<R, P, N> PropertiesServiceImpl<R, P, N>
where
    R: PropertiesRepo,
    P: PermissionService,
    N: NotificationService,
    anyhow::Error: From<R::Err> + From<P::Err> + From<N::Err>,
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
        assigned_by_user_id: &str,
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
        self.handle_task_assignee_notifications(task_id, &assignee_ids, assigned_by_user_id)
            .await?;
        Ok(())
    }

    /// Handle notifications when task assignees are updated.
    /// Only sends notifications to NEW assignees (not already assigned).
    /// Also filters out the assigner from notifications.
    /// Notifications are sent asynchronously and errors are logged but don't fail the operation.
    pub async fn handle_task_assignee_notifications(
        &self,
        task_id: Uuid,
        assignee_ids: &[String],
        assigned_by_user_id: &str,
    ) -> Result<(), PropertiesErr> {
        if assignee_ids.is_empty() {
            return Ok(());
        }

        let notification_service = match &self.notification_service {
            Some(service) => service,
            None => {
                tracing::debug!("notification service not available, skipping notifications");
                return Ok(());
            }
        };

        // Get current assignees to determine which are new
        use models_properties::service::property_value::PropertyValue;
        let current_value = self
            .repository
            .get_entity_property_value(
                &task_id.to_string(),
                EntityType::Task,
                SystemPropertyKey::ASSIGNEES_UUID,
            )
            .await
            .map_err(anyhow::Error::from)
            .map_err(PropertiesErr::Repo)?;

        let current_assignee_ids: Vec<String> = match current_value {
            Some(PropertyValue::EntityRef(refs)) => {
                refs.iter().map(|r| r.entity_id.clone()).collect()
            }
            _ => vec![],
        };

        // Find new assignees (those in new list but not in current list)
        let new_assignees: Vec<String> = assignee_ids
            .iter()
            .filter(|new_id| !current_assignee_ids.contains(new_id))
            .cloned()
            .collect();

        if new_assignees.is_empty() {
            tracing::debug!("no new assignees, skipping notifications");
            return Ok(());
        }

        // Get task name from repository
        let task_name = self
            .repository
            .get_entity_name(&task_id.to_string(), EntityType::Task)
            .await
            .map_err(anyhow::Error::from)
            .map_err(PropertiesErr::Repo)?;

        // Filter out the assigner from new assignees
        let recipient_ids: Vec<String> = new_assignees
            .iter()
            .filter(|assignee_id| assignee_id != &assigned_by_user_id)
            .cloned()
            .collect();

        if recipient_ids.is_empty() {
            tracing::debug!("no recipients after filtering assigner, skipping notifications");
            return Ok(());
        }

        // Parse assigned_by_user_id to MacroUserIdStr
        use macro_user_id::cowlike::CowLike;
        let assigned_by =
            macro_user_id::user_id::MacroUserIdStr::parse_from_str(assigned_by_user_id)
                .map_err(|e| PropertiesErr::Validation(format!("Invalid user ID format: {}", e)))?
                .into_owned();

        // Create notification metadata
        let metadata = model_notifications::TaskAssignedMetadata {
            task_id: task_id.to_string(),
            task_name,
            assigned_by,
        };

        // Create notification event
        let notification_event = model_notifications::NotificationEvent::TaskAssigned(metadata);

        // Create entity for notification
        // Tasks are stored as documents, so we use Document entity type
        let notification_entity =
            model_entity::EntityType::Document.with_entity_string(task_id.to_string());

        // Send notifications to all recipients in parallel.
        // Errors are logged but don't fail the operation - we continue sending to other recipients even if one fails.
        use futures::future::join_all;

        let notification_futures: Vec<_> = recipient_ids
            .iter()
            .map(|recipient_id| {
                let message = model_notifications::NotificationQueueMessage {
                    notification_entity: notification_entity.clone(),
                    notification_event: notification_event.clone(),
                    sender_id: Some(assigned_by.clone()),
                    recipient_ids: Some(vec![recipient_id.clone()]),
                };

                let recipient_id_for_log = recipient_id.clone();
                async move {
                    let send_result = notification_service.send_notification(message).await;
                    match send_result {
                        Ok(notification_id) => {
                            tracing::debug!(
                                recipient_id = %recipient_id_for_log,
                                notification_id = %notification_id,
                                "sent task assignment notification"
                            );
                        }
                        Err(e) => {
                            tracing::error!(
                                recipient_id = %recipient_id_for_log,
                                error = ?e,
                                "failed to send task assignment notification"
                            );
                        }
                    }
                }
            })
            .collect();

        join_all(notification_futures).await;

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
            .grant_entity_permissions(assignee_ids, &task_id.to_string(), EntityType::Task)
            .await
            .map_err(anyhow::Error::from)
            .map_err(PropertiesErr::Repo)?;

        Ok(())
    }
}
