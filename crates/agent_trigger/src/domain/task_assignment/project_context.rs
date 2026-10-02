//! Current project context for an authorized task assignment.

use agent_session::domain::error::{AgentSessionError, Result};
use channel_sender::ChannelSender;
use entity_access::domain::models::{EntityAccessAuth, EntityAccessReceipt};
use initiative::domain::events::InitiativeEventActor;
use messages::domain::service::MessageWrite;

use crate::domain::project_assignment::{ProjectAssignmentAccess, ProjectMemberships};

use super::{TaskAssignmentContext, TaskBrief};

#[cfg(test)]
mod test;

/// Enriches task briefs with the current project only when the same actor can view it.
pub struct ProjectTaskAssignmentContext<C, M, A> {
    tasks: C,
    memberships: M,
    access: A,
}

impl<C, M, A> ProjectTaskAssignmentContext<C, M, A> {
    /// Compose task content, current memberships, and project authorization ports.
    pub fn new(tasks: C, memberships: M, access: A) -> Self {
        Self {
            tasks,
            memberships,
            access,
        }
    }
}

impl<C, M, A> TaskAssignmentContext for ProjectTaskAssignmentContext<C, M, A>
where
    C: TaskAssignmentContext,
    M: ProjectMemberships + 'static,
    A: ProjectAssignmentAccess + 'static,
{
    async fn task_brief(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
    ) -> Result<Option<TaskBrief>> {
        let Some(mut brief) = self.tasks.task_brief(access.clone()).await? else {
            return Ok(None);
        };
        // Membership may have changed since another source built the brief.
        brief.project_id = None;
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
            .is_some()
        {
            brief.project_id = Some(project);
        }
        Ok(Some(brief))
    }
}
