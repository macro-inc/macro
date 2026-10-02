//! Inherit project agents when a task enters a project.

use std::collections::HashMap;

use entity_access::domain::{
    models::{AccessError, BotAccessScope, EntityAccessReceipt, EntityType, RequiredPermission},
    ports::EntityAccessService,
};
use initiative::domain::{
    events::{InitiativeEventActor, InitiativeTasksChanged},
    models::{InitiativeError, InitiativeId},
    ports::InitiativeRepo,
};
use properties::{EditReceipt, PropertiesErr, PropertiesService, ViewReceipt};

#[cfg(test)]
mod test;

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

    /// Recheck queued membership changes before inheriting the destination's agents.
    #[tracing::instrument(err, skip_all)]
    pub async fn process(
        &self,
        event: &InitiativeTasksChanged,
    ) -> Result<(), ProjectAssignmentError> {
        let Some(attribution) = &event.attribution else {
            return Ok(());
        };
        let Some(_) = attribution
            .actor
            .as_user()
            .or(attribution.on_behalf_of.as_ref())
        else {
            return Ok(());
        };
        let additions: Vec<_> = event
            .changes
            .iter()
            .filter(|change| change.to.is_some() && change.to != change.from)
            .collect();
        if additions.is_empty() {
            return Ok(());
        }
        let memberships = self
            .initiatives
            .memberships(
                additions
                    .iter()
                    .map(|change| change.task_id.clone())
                    .collect(),
            )
            .await?;
        for change in additions {
            let Some(project_id) = change
                .to
                .filter(|id| memberships.get(&change.task_id) == Some(id))
            else {
                continue;
            };
            let Some((project, task)) = self
                .access
                .receipts(attribution, project_id, &change.task_id)
                .await?
            else {
                continue;
            };
            match self.properties.inherit(&project, &task).await {
                Ok(()) => {}
                Err(
                    error
                    @ (PropertiesErr::Repo(_) | PropertiesErr::PermissionServiceNotConfigured),
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
                        task_id = %change.task_id,
                        project_id = %project_id,
                        "skipping invalid project agent assignment"
                    );
                }
            }
        }
        Ok(())
    }
}
