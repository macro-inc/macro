//! Current project context for an authorized task assignment.

use agent_session::domain::error::{AgentSessionError, Result};
use channel_sender::ChannelSender;
use entity_access::domain::models::{EntityAccessAuth, EntityAccessReceipt};
use initiative::domain::{events::InitiativeEventActor, lookup::InitiativeReader};
use messages::domain::service::MessageWrite;
use trigger_context::ProjectRef;

use crate::domain::project_assignment::{ProjectAssignmentAccess, ProjectMemberships};

use super::{TaskAssignmentContext, TaskBrief};

#[cfg(test)]
mod test;

/// Enriches task briefs with the current project only when the same actor can view it.
pub struct ProjectTaskAssignmentContext<Tasks, Memberships, Access, Projects> {
    tasks: Tasks,
    memberships: Memberships,
    access: Access,
    projects: Projects,
}

impl<Tasks, Memberships, Access, Projects>
    ProjectTaskAssignmentContext<Tasks, Memberships, Access, Projects>
{
    /// Compose task content, current memberships, project authorization, and
    /// project identity ports.
    pub fn new(tasks: Tasks, memberships: Memberships, access: Access, projects: Projects) -> Self {
        Self {
            tasks,
            memberships,
            access,
            projects,
        }
    }
}

impl<Tasks, Memberships, Access, Projects> TaskAssignmentContext
    for ProjectTaskAssignmentContext<Tasks, Memberships, Access, Projects>
where
    Tasks: TaskAssignmentContext,
    Memberships: ProjectMemberships + 'static,
    Access: ProjectAssignmentAccess + 'static,
    Projects: InitiativeReader,
{
    async fn task_brief(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
    ) -> Result<Option<TaskBrief>> {
        let Some(mut brief) = self.tasks.task_brief(access.clone()).await? else {
            return Ok(None);
        };
        // Membership may have changed since another source built the brief.
        brief.project = None;
        let actor = match access.auth() {
            EntityAccessAuth::Authenticated(user) => InitiativeEventActor {
                actor: ChannelSender::new_from_user(user.clone()),
                on_behalf_of: None,
            },
            EntityAccessAuth::Bot(bot) => {
                let Some(user) = bot.scope().acting_user_id() else {
                    return Ok(Some(brief));
                };
                InitiativeEventActor {
                    actor: ChannelSender::new_from_bot(bot.bot_id()),
                    on_behalf_of: Some(user.clone()),
                }
            }
            EntityAccessAuth::Unauthenticated | EntityAccessAuth::Internal => {
                return Ok(Some(brief));
            }
        };
        let task = &access.entity().entity_id;
        let memberships = self
            .memberships
            .memberships(vec![task.clone()])
            .await
            .map_err(|error| AgentSessionError::Unknown(error.into()))?;
        let Some(project) = memberships.get(task).copied() else {
            return Ok(Some(brief));
        };
        if self
            .access
            .receipts(&actor, project, task)
            .await
            .map_err(|error| AgentSessionError::Unknown(error.into()))?
            .is_none()
        {
            return Ok(Some(brief));
        }
        // A project deleted since the membership read is not named.
        brief.project = self
            .projects
            .read_basic(project)
            .await
            .map_err(|error| AgentSessionError::Unknown(error.into()))?
            .map(|project| ProjectRef {
                id: project.id.as_uuid(),
                name: project.name,
            });
        Ok(Some(brief))
    }
}
