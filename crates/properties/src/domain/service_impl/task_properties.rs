//! Task-specific property handlers.

use std::collections::HashSet;

use entity_access::domain::models::EntityAccessAuth;
use macro_event_broker::MacroEventBroker;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::EntityType;
use models_properties::api::requests::SetPropertyValue;
use models_properties::service::{entity_property::EntityProperty, property_value::PropertyValue};
use system_properties::SystemPropertyKey;
use uuid::Uuid;

use crate::domain::error::PropertiesErr;
use crate::domain::model::{EditReceipt, PropertyAccessReceiptExt, TaskAssignedNotification};
use crate::domain::ports::{NotificationService, PermissionService, PropertiesRepo};
use crate::domain::service_impl::PropertiesServiceImpl;

impl<R, P, N, B> PropertiesServiceImpl<R, P, N, B>
where
    R: PropertiesRepo,
    P: PermissionService,
    N: NotificationService,
    B: MacroEventBroker,
    anyhow::Error: From<R::Err> + From<P::Err> + From<N::Err>,
{
    /// Require edit access to every referenced task before linking: linking
    /// mutates the referenced task's Parent Task / Subtasks property, so edit
    /// access to the primary task alone is not enough. Internal (machine)
    /// callers are trusted and skip the check.
    async fn check_referenced_task_edit_access(
        &self,
        access: &EditReceipt,
        referenced_task_ids: &[Uuid],
    ) -> Result<(), PropertiesErr> {
        let user_id = match access.auth() {
            EntityAccessAuth::Internal => return Ok(()),
            EntityAccessAuth::Unauthenticated => {
                return Err(PropertiesErr::PermissionDenied);
            }
            EntityAccessAuth::Authenticated(_) | EntityAccessAuth::Bot(_) => access
                .acting_user_id()
                .ok_or(PropertiesErr::PermissionDenied)?,
        };
        if referenced_task_ids.is_empty() {
            return Ok(());
        }
        let permission_service = self.permission_service()?;
        for task_id in referenced_task_ids {
            permission_service
                .mint_edit_receipt(
                    user_id,
                    &task_id.to_string(),
                    entity_access::domain::models::EntityType::Document,
                )
                .await
                .map_err(|_| PropertiesErr::PermissionDenied)?;
        }
        Ok(())
    }

    /// Handle task relationship properties (Parent Task / Subtasks) with bidirectional linking.
    pub(crate) async fn handle_task_relationship_property(
        &self,
        access: &EditReceipt,
        property_definition_id: Uuid,
        value: Option<SetPropertyValue>,
    ) -> Result<EntityProperty, PropertiesErr> {
        let task_id = Uuid::parse_str(access.entity_id())
            .map_err(|_| PropertiesErr::Validation("Invalid task ID".to_string()))?;

        let property = match property_definition_id {
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

                self.check_referenced_task_edit_access(access, parent_task_id.as_slice())
                    .await?;

                self.repository
                    .link_parent_task(task_id, parent_task_id)
                    .await
                    .map_err(anyhow::Error::from)?
                    .ok_or(PropertiesErr::EntityPropertyNotFound)?
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

                self.check_referenced_task_edit_access(access, &subtask_ids)
                    .await?;

                self.repository
                    .link_subtasks(task_id, subtask_ids)
                    .await
                    .map_err(anyhow::Error::from)?
                    .ok_or(PropertiesErr::EntityPropertyNotFound)?
            }
            _ => {
                return Err(PropertiesErr::Validation(
                    "Invalid property for task relationship handling".to_string(),
                ));
            }
        };

        Ok(property)
    }

    /// Handle task assignees property with permissions.
    pub(crate) async fn handle_task_assignees_property(
        &self,
        entity_id: &str,
        value: Option<SetPropertyValue>,
        assigned_by_user_id: Option<&MacroUserIdStr<'_>>,
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

    /// Handle notifications when task assignees are updated. Internal
    /// (machine) writes have no assigning user and send no notifications.
    pub async fn handle_task_assignee_notifications(
        &self,
        task_id: Uuid,
        assignee_ids: &[MacroUserIdStr<'_>],
        assigned_by_user_id: Option<&MacroUserIdStr<'_>>,
    ) -> Result<(), PropertiesErr> {
        if assignee_ids.is_empty() {
            return Ok(());
        }

        let Some(assigned_by_user_id) = assigned_by_user_id else {
            tracing::debug!("no assigning user (internal write), skipping notifications");
            return Ok(());
        };

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
                !current_assignee_ids.contains(id.as_ref())
                    && id.as_ref() != assigned_by_user_id.as_ref()
            })
            .map(|id| id.copied())
            .collect();

        if recipient_ids.is_empty() {
            tracing::debug!("no new assignees to notify");
            return Ok(());
        }

        let assigned_by = assigned_by_user_id.copied();

        notification_service
            .send_task_assigned(TaskAssignedNotification {
                task_id,
                assigned_by,
                recipient_ids,
            })
            .await
            .map_err(anyhow::Error::from)
            .map_err(PropertiesErr::Repo)?;

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

        let permission_service = self.permission_service()?;

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
