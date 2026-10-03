//! Inherit project agents when a task enters a project.

use std::collections::HashMap;

use channel_sender::ChannelSender;
use entity_access::domain::{
    models::{AccessError, BotAccessScope, EntityAccessReceipt, EntityType, RequiredPermission},
    ports::EntityAccessService,
};
use initiative::domain::{
    events::InitiativeEventActor,
    models::{InitiativeError, InitiativeId},
    ports::InitiativeRepo,
};
use models_properties::{EntityType as PropertyEntityType, service::property_value::PropertyValue};
use properties::domain::events::EntityPropertyUpdatedMetadata;
use properties::{EditReceipt, PropertiesErr, PropertiesService, ViewReceipt};
use system_properties::SystemPropertyKey;

#[cfg(test)]
mod test;

/// A task that joined a project: its Project property now names a different project.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectTaskAdded {
    /// Task that joined the project.
    pub task_id: String,
    /// Project the task joined.
    pub project_id: InitiativeId,
    /// Who set the property.
    pub actor: InitiativeEventActor,
}

impl ProjectTaskAdded {
    /// Ignore other properties, removals, unchanged saves, and unattributed writes.
    pub fn from_update(updated: &EntityPropertyUpdatedMetadata) -> Option<Self> {
        if updated.entity_type != PropertyEntityType::Task
            || updated.property_definition_id != SystemPropertyKey::PROJECT_UUID
        {
            return None;
        }
        let project_id = project_of(updated.value.as_ref())?;
        if project_of(updated.previous_value.as_ref()) == Some(project_id) {
            return None;
        }
        let actor = match (&updated.actor, &updated.actor_user_id) {
            (Some(actor), _) => InitiativeEventActor {
                actor: actor.clone(),
                on_behalf_of: updated.on_behalf_of.clone(),
            },
            (None, Some(user)) => InitiativeEventActor {
                actor: ChannelSender::new_from_user(user.clone()),
                on_behalf_of: None,
            },
            (None, None) => return None,
        };
        Some(Self {
            task_id: updated.entity_id.clone(),
            project_id,
            actor,
        })
    }
}

fn project_of(value: Option<&PropertyValue>) -> Option<InitiativeId> {
    let Some(PropertyValue::EntityRef(references)) = value else {
        return None;
    };
    references
        .iter()
        .find(|reference| reference.entity_type == PropertyEntityType::Initiative)
        .and_then(|reference| reference.entity_id.parse().ok())
}

/// Failure to read or apply a project assignment; the consumer retries the event.
#[derive(Debug, thiserror::Error)]
pub enum ProjectAssignmentError {
    /// Current project membership could not be read.
    #[error(transparent)]
    Initiative(#[from] InitiativeError),
    /// Current access could not be checked.
    #[error(transparent)]
    Access(#[from] AccessError),
    /// Assignees could not be inherited.
    #[error(transparent)]
    Properties(#[from] PropertiesErr),
}

/// The current membership facts needed to discard superseded queued moves.
#[cfg_attr(test, mockall::automock)]
pub trait ProjectMemberships: Send + Sync {
    /// Read all candidate tasks in one batch.
    fn memberships(
        &self,
        tasks: Vec<String>,
    ) -> impl Future<Output = Result<HashMap<String, InitiativeId>, InitiativeError>> + Send;
}

impl<R: InitiativeRepo> ProjectMemberships for R {
    async fn memberships(
        &self,
        tasks: Vec<String>,
    ) -> Result<HashMap<String, InitiativeId>, InitiativeError> {
        self.task_memberships(tasks).await.map_err(Into::into)
    }
}

/// Current capabilities for the user responsible for the membership change.
#[cfg_attr(test, mockall::automock)]
pub trait ProjectAssignmentAccess: Send + Sync {
    /// Missing access discards the assignment; infrastructure failures retry it.
    fn receipts(
        &self,
        actor: &InitiativeEventActor,
        project: InitiativeId,
        task: &str,
    ) -> impl Future<Output = Result<Option<(ViewReceipt, EditReceipt)>, AccessError>> + Send;
}

impl<A: EntityAccessService> ProjectAssignmentAccess for A {
    async fn receipts(
        &self,
        actor: &InitiativeEventActor,
        project: InitiativeId,
        task: &str,
    ) -> Result<Option<(ViewReceipt, EditReceipt)>, AccessError> {
        let Some(project) = current_access(
            attributed_receipt(self, actor, &project.to_string(), EntityType::Initiative).await,
        )?
        else {
            return Ok(None);
        };
        let Some(task) =
            current_access(attributed_receipt(self, actor, task, EntityType::Document).await)?
        else {
            return Ok(None);
        };
        Ok(Some((project, task)))
    }
}

async fn attributed_receipt<A: EntityAccessService, T: RequiredPermission>(
    access: &A,
    attribution: &InitiativeEventActor,
    entity_id: &str,
    entity_type: EntityType,
) -> Result<EntityAccessReceipt<T>, AccessError> {
    if let Some(user) = attribution.actor.as_user() {
        return access
            .generate_entity_access_receipt(user, None, entity_id, entity_type)
            .await;
    }
    let bot = attribution
        .actor
        .as_bot()
        .ok_or(AccessError::Unauthorized)?;
    let user = attribution
        .on_behalf_of
        .clone()
        .ok_or(AccessError::Unauthorized)?;
    access
        .generate_bot_entity_access_receipt(
            bot.bot_id(),
            BotAccessScope::user(user),
            entity_id,
            entity_type,
        )
        .await
}

fn current_access<T>(result: Result<T, AccessError>) -> Result<Option<T>, AccessError> {
    match result {
        Ok(receipt) => Ok(Some(receipt)),
        Err(
            AccessError::Unauthorized
            | AccessError::UnauthorizedWithMessage(_)
            | AccessError::NotFound(_),
        ) => Ok(None),
        Err(error) => Err(error),
    }
}

/// The property domain's atomic merge of project agents into task assignees.
#[cfg_attr(test, mockall::automock)]
pub trait ProjectAgentInheritance: Send + Sync {
    /// Preserve existing assignees and publish the committed assignment delta.
    fn inherit(
        &self,
        project: &ViewReceipt,
        task: &EditReceipt,
    ) -> impl Future<Output = Result<(), PropertiesErr>> + Send;
}

impl<P: PropertiesService> ProjectAgentInheritance for P {
    async fn inherit(
        &self,
        project: &ViewReceipt,
        task: &EditReceipt,
    ) -> Result<(), PropertiesErr> {
        self.inherit_project_agent_assignees(project, task).await
    }
}

/// Applies project defaults to committed additions and moves, never existing tasks.
pub struct ProjectAssignmentService<P, I, A> {
    properties: P,
    initiatives: I,
    access: A,
}

impl<P: ProjectAgentInheritance, I: ProjectMemberships, A: ProjectAssignmentAccess>
    ProjectAssignmentService<P, I, A>
{
    /// Compose the owning property, initiative, and access capabilities.
    pub fn new(properties: P, initiatives: I, access: A) -> Self {
        Self {
            properties,
            initiatives,
            access,
        }
    }

    /// Recheck a queued addition before inheriting the destination's agents.
    #[tracing::instrument(err, skip_all)]
    pub async fn process(&self, added: &ProjectTaskAdded) -> Result<(), ProjectAssignmentError> {
        let Some(_) = added
            .actor
            .actor
            .as_user()
            .or(added.actor.on_behalf_of.as_ref())
        else {
            return Ok(());
        };
        let memberships = self
            .initiatives
            .memberships(vec![added.task_id.clone()])
            .await?;
        // A later move or removal supersedes this addition.
        if memberships.get(&added.task_id) != Some(&added.project_id) {
            return Ok(());
        }
        let Some((project, task)) = self
            .access
            .receipts(&added.actor, added.project_id, &added.task_id)
            .await?
        else {
            return Ok(());
        };
        match self.properties.inherit(&project, &task).await {
            Ok(()) => {}
            Err(
                error @ (PropertiesErr::Repo(_) | PropertiesErr::PermissionServiceNotConfigured),
            ) => {
                return Err(error.into());
            }
            Err(
                error @ (PropertiesErr::Validation(_)
                | PropertiesErr::PermissionDenied
                | PropertiesErr::NotFound
                | PropertiesErr::OptionNotFound
                | PropertiesErr::EntityPropertyNotFound
                | PropertiesErr::RequiredProperty
                | PropertiesErr::DuplicateOptionValue
                | PropertiesErr::ConflictingTeamLabel(_)
                | PropertiesErr::SystemPropertyNotModifiable
                | PropertiesErr::TeamMembershipRequired
                | PropertiesErr::ManagedDefinition),
            ) => {
                tracing::warn!(
                    error = ?error,
                    task_id = %added.task_id,
                    project_id = %added.project_id,
                    "skipping invalid project agent assignment"
                );
            }
        }
        Ok(())
    }
}
