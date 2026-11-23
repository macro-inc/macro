//! Task-specific property handlers.

#[cfg(test)]
mod test;

use std::collections::HashSet;

use bot_id::BotIdStr;
use entity_access::domain::models::EntityAccessAuth;
use macro_event_broker::MacroEventBroker;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::EntityType;
use models_properties::api::requests::SetPropertyValue;
use models_properties::service::{entity_property::EntityProperty, property_value::PropertyValue};
use models_properties::shared::EntityReference;
use system_properties::SystemPropertyKey;
use uuid::Uuid;

use crate::domain::error::PropertiesErr;
use crate::domain::model::{EditReceipt, PropertyAccessReceiptExt, TaskAssignedNotification};
use crate::domain::ports::{
    NotificationService, PermissionService, PropertiesRepo, TaskDependencyLinkOutcome,
};
use crate::domain::service_impl::PropertiesServiceImpl;

/// Canonical relationship write and its post-commit publication receipts.
#[derive(Debug)]
pub(crate) struct TaskRelationshipMutation {
    /// The edited task's persisted assignment.
    pub property: EntityProperty,
    /// The complete pre-write graph snapshot.
    pub previous_value: Option<PropertyValue>,
    /// Canonical changed inverse assignments, read before commit.
    pub reciprocal: Vec<crate::domain::model::EntityPropertyMutationSnapshot>,
}
impl<R, P, N, B> PropertiesServiceImpl<R, P, N, B>
where
    R: PropertiesRepo,
    P: PermissionService,
    N: NotificationService,
    B: MacroEventBroker,
    anyhow::Error: From<R::Err> + From<P::Err> + From<N::Err>,
{
    /// Share the initiative through its owner domain before persisting assignees.
    /// Clearing responsibility leaves previously granted edit access intact,
    /// just as task assignment does.
    pub(crate) async fn handle_initiative_assignees_property(
        &self,
        access: &EditReceipt,
        value: &Option<PropertyValue>,
    ) -> Result<(), PropertiesErr> {
        let Some(PropertyValue::EntityRef(references)) = value else {
            return Ok(());
        };
        let mut assignee_ids = Vec::new();
        for reference in references {
            if reference.entity_type != EntityType::User {
                return Err(PropertiesErr::Validation(
                    "Assignees must reference users or agents".to_string(),
                ));
            }
            // Agents act with the delegating user's access; only human
            // assignees receive direct project collaboration grants.
            if BotIdStr::parse_from_str(&reference.entity_id).is_ok() {
                continue;
            }
            assignee_ids.push(
                MacroUserIdStr::parse_from_str(&reference.entity_id)
                    .map(|user_id| user_id.into_owned())
                    .map_err(|error| PropertiesErr::Validation(error.to_string()))?,
            );
        }
        if assignee_ids.is_empty() {
            return Ok(());
        }
        self.initiative_assignees
            .as_ref()
            .ok_or(PropertiesErr::PermissionServiceNotConfigured)?
            .grant_assignees(access, assignee_ids)
            .await
    }

    /// Require edit access to every referenced task before linking: linking
    /// mutates the referenced task's inverse property, so edit
    /// access to the primary task alone is not enough. Internal (machine)
    /// callers are trusted and skip the check.
    async fn check_referenced_task_edit_access(
        &self,
        access: &EditReceipt,
        referenced_task_ids: &[Uuid],
    ) -> Result<(), PropertiesErr> {
        let user_id = match access.auth() {
            EntityAccessAuth::Internal => return Ok(()),
            EntityAccessAuth::Unauthenticated => return Err(PropertiesErr::PermissionDenied),
            EntityAccessAuth::Authenticated(_) | EntityAccessAuth::Bot(_) => access
                .acting_user_id()
                .ok_or(PropertiesErr::PermissionDenied)?,
        };
        if referenced_task_ids.is_empty() {
            return Ok(());
        }
        self.permission_service()?
            .mint_document_edit_receipts(user_id, referenced_task_ids)
            .await
            .map_err(|_| PropertiesErr::PermissionDenied)?;
        Ok(())
    }

    /// Require the acting user's edit access to every referenced entity.
    /// Internal (machine) callers are trusted and skip the check.
    async fn check_referenced_edit_access(
        &self,
        access: &EditReceipt,
        entity_type: entity_access::domain::models::EntityType,
        referenced_ids: &[impl std::fmt::Display],
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
        if referenced_ids.is_empty() {
            return Ok(());
        }
        let permission_service = self.permission_service()?;
        for id in referenced_ids {
            permission_service
                .mint_edit_receipt(user_id, &id.to_string(), entity_type)
                .await
                .map_err(|_| PropertiesErr::PermissionDenied)?;
        }
        Ok(())
    }

    /// A task belongs to at most one project. Joining one changes what the
    /// project shows, so it also needs edit access to the project; leaving
    /// needs task edit access alone. Returns the value with the project id
    /// in canonical form, which project task lists match on.
    pub(crate) async fn validate_task_project(
        &self,
        access: &EditReceipt,
        value: Option<PropertyValue>,
    ) -> Result<Option<PropertyValue>, PropertiesErr> {
        let Some(PropertyValue::EntityRef(references)) = &value else {
            return Ok(value);
        };
        let project_id = match references.as_slice() {
            [] => return Ok(value),
            [reference] if reference.entity_type == EntityType::Initiative => {
                Uuid::parse_str(&reference.entity_id).map_err(|_| {
                    PropertiesErr::Validation("Project must reference a project id".to_string())
                })?
            }
            _ => {
                return Err(PropertiesErr::Validation(
                    "Project must reference one project".to_string(),
                ));
            }
        };
        self.check_referenced_edit_access(
            access,
            entity_access::domain::models::EntityType::Initiative,
            &[project_id],
        )
        .await?;
        Ok(Some(PropertyValue::EntityRef(vec![EntityReference {
            entity_id: project_id.to_string(),
            entity_type: EntityType::Initiative,
            specific_message_id: None,
        }])))
    }

    /// Handle task relationship properties with bidirectional linking.
    #[tracing::instrument(skip_all, fields(task_id = %access.entity_id(), property_definition_id = %property_definition_id), err)]
    pub(crate) async fn handle_task_relationship_property(
        &self,
        access: &EditReceipt,
        property_definition_id: Uuid,
        value: Option<SetPropertyValue>,
    ) -> Result<TaskRelationshipMutation, PropertiesErr> {
        let task_id = Uuid::parse_str(access.entity_id())
            .map_err(|_| PropertiesErr::Validation("Invalid task ID".to_string()))?;

        let mut previous_value = None;
        let mut reciprocal = Vec::new();
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
            SystemPropertyKey::DEPENDS_ON_UUID | SystemPropertyKey::BLOCKING_UUID => {
                let references = match &value {
                    None => &[][..],
                    Some(SetPropertyValue::MultiEntityReference { references }) => references,
                    Some(_) => {
                        return Err(PropertiesErr::Validation(
                            "Task dependencies require multiple task references".to_string(),
                        ));
                    }
                };
                if references.len() > 1000 {
                    return Err(PropertiesErr::Validation(
                        "At most 1000 task relationships can be edited at once".into(),
                    ));
                }
                let mut desired = HashSet::new();
                for reference in references {
                    if reference.entity_type != EntityType::Task {
                        return Err(PropertiesErr::Validation(
                            "Task dependencies must reference tasks".to_string(),
                        ));
                    }
                    let id = Uuid::parse_str(&reference.entity_id)
                        .map_err(|_| PropertiesErr::Validation("Invalid task ID".to_string()))?;
                    if id == task_id {
                        return Err(PropertiesErr::Validation(
                            "A task cannot depend on itself".to_string(),
                        ));
                    }
                    desired.insert(id);
                }

                let current = self
                    .repository
                    .task_dependency_targets(task_id, property_definition_id)
                    .await
                    .map_err(anyhow::Error::from)?;
                previous_value = Some(PropertyValue::EntityRef(
                    current
                        .iter()
                        .map(|id| EntityReference::new(id.to_string(), EntityType::Task))
                        .collect(),
                ));
                // Only changed edges mutate inverse properties. Keep the full
                // snapshot for the repository's endpoint locks and stale check.
                let current_set: HashSet<Uuid> = current.iter().copied().collect();
                let touched = current_set
                    .symmetric_difference(&desired)
                    .copied()
                    .collect::<Vec<_>>();
                self.check_referenced_task_edit_access(access, &touched)
                    .await?;

                match self
                    .repository
                    .link_task_dependencies(
                        task_id,
                        property_definition_id,
                        current,
                        desired.into_iter().collect(),
                    )
                    .await
                    .map_err(anyhow::Error::from)?
                {
                    TaskDependencyLinkOutcome::Updated(property, effects) => {
                        reciprocal = effects;
                        property
                    }
                    TaskDependencyLinkOutcome::Stale => {
                        return Err(PropertiesErr::DependencyContended);
                    }
                    TaskDependencyLinkOutcome::Cycle => {
                        return Err(PropertiesErr::Validation(
                            "Task dependency cycle".to_string(),
                        ));
                    }
                    TaskDependencyLinkOutcome::MissingTask => {
                        return Err(PropertiesErr::Validation(
                            "Task dependency endpoint not found".to_string(),
                        ));
                    }
                }
            }
            _ => {
                return Err(PropertiesErr::Validation(
                    "Invalid property for task relationship handling".to_string(),
                ));
            }
        };

        Ok(TaskRelationshipMutation {
            property,
            previous_value,
            reciprocal,
        })
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

        let mut assignee_ids = Vec::new();
        for reference in references {
            if reference.entity_type != EntityType::User {
                return Err(PropertiesErr::Validation(
                    "Assignees must reference users or agents".to_string(),
                ));
            }

            // Agent identities share the User reference namespace. Their
            // sessions run with the assigning user's access, so only humans
            // receive direct task permissions and assignment notifications.
            if BotIdStr::parse_from_str(&reference.entity_id).is_ok() {
                continue;
            }
            assignee_ids.push(
                MacroUserIdStr::parse_from_str(&reference.entity_id)
                    .map_err(|error| PropertiesErr::Validation(error.to_string()))?,
            );
        }
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
