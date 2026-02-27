//! Task-specific property handlers.

use std::collections::HashSet;

use futures::future::join_all;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::EntityType;
use models_properties::api::requests::SetPropertyValue;
use models_properties::service::property_value::PropertyValue;
use notification::domain::models::SendNotificationRequestBuilder;
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
                return Err(PropertiesErr::Validation(
                    "Invalid property for task relationship handling".to_string(),
                ));
            }
        }

        Ok(())
    }

    /// Handle task assignees property with permissions.
    pub async fn handle_task_assignees_property(
        &self,
        entity_id: &str,
        value: Option<SetPropertyValue>,
        assigned_by_user_id: &str,
    ) -> Result<(), PropertiesErr> {
        let Some(SetPropertyValue::MultiEntityReference { references }) = &value else {
            if value.is_some() {
                return Err(PropertiesErr::Validation(
                    "Assignees requires multiple entity references".to_string(),
                ));
            }
            return Ok(());
        };

        let assignee_ids = references
            .iter()
            .map(|r| MacroUserIdStr::parse_from_str(&r.entity_id))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| PropertiesErr::Validation(e.to_string()))?;
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
    pub async fn handle_task_assignee_notifications(
        &self,
        task_id: Uuid,
        assignee_ids: &[MacroUserIdStr<'_>],
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

        let current_assignee_ids: HashSet<String> = match current_value {
            Some(PropertyValue::EntityRef(refs)) => {
                refs.iter().map(|r| r.entity_id.clone()).collect()
            }
            _ => Default::default(),
        };

        let recipient_ids: Vec<MacroUserIdStr<'_>> = assignee_ids
            .iter()
            .filter(|id| {
                !current_assignee_ids.contains(id.as_ref()) && id.as_ref() != assigned_by_user_id
            })
            .map(|id| id.copied())
            .collect();

        if recipient_ids.is_empty() {
            tracing::debug!("no new assignees to notify");
            return Ok(());
        }

        let task_name = self
            .repository
            .get_document_name(&task_id.to_string())
            .await
            .map_err(anyhow::Error::from)
            .map_err(PropertiesErr::Repo)?;

        let assigned_by =
            macro_user_id::user_id::MacroUserIdStr::parse_from_str(assigned_by_user_id)
                .map_err(|e| PropertiesErr::Validation(format!("Invalid user ID format: {}", e)))?
                .into_owned();

        let notification_entity =
            model_entity::EntityType::Document.with_entity_string(task_id.to_string());

        let sender_profile_picture_url = self
            .repository
            .get_user_profile_picture(assigned_by_user_id)
            .await
            .ok()
            .flatten();

        let notification_futures: Vec<_> = recipient_ids
            .iter()
            .map(|recipient_id| {
                let metadata = model_notifications::TaskAssignedMetadata {
                    task_id: task_id.to_string(),
                    task_name: task_name.clone(),
                    assigned_by: assigned_by.clone(),
                    sender_profile_picture_url: sender_profile_picture_url.clone(),
                };

                let request = SendNotificationRequestBuilder {
                    notification_entity: notification_entity.clone(),
                    notification: metadata,
                    sender_id: Some(assigned_by.clone()),
                    recipient_ids: HashSet::from([recipient_id.copied()]),
                }
                .into_request()
                .with_apns()
                .with_conn_gateway();

                let recipient_id_for_log = recipient_id.clone();
                async move {
                    let send_result = notification_service.send_notification(request).await;
                    match send_result {
                        Ok(notification_id) => {
                            tracing::debug!(
                                recipient_id = %recipient_id_for_log,
                                notification_id = %notification_id,
                                "sent task assignment notification"
                            );
                        }
                        Err(_e) => {
                            tracing::error!(
                                recipient_id = %recipient_id_for_log,
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
    pub async fn handle_task_assignee_permissions(
        &self,
        task_id: Uuid,
        assignee_ids: &[MacroUserIdStr<'_>],
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
