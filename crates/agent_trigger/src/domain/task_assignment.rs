//! Turn task-assignee property changes into agent-session trigger events.
//!
//! The properties domain accepts agents (`bot|<uuid>`) alongside users in a
//! task's Assignees property and publishes the change like any other property
//! write. This module watches those events and, for each agent that was newly
//! assigned by someone allowed to use it, yields a
//! [`NewAgentSessionEvent::TaskAssigned`] for the harness to open a session
//! on.

use std::collections::HashSet;

use agent_session::domain::error::Result;
use bot_id::{BotId, BotIdStr};
use bots::domain::models::{BotKind, BotOwner};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use models_properties::EntityType;
use models_properties::service::property_value::PropertyValue;
use properties::domain::events::{EntityPropertyUpdatedMetadata, PropertyTopicEvent};
use system_properties::SystemPropertyKey;

use crate::domain::broker_events::{
    AgentSessionMacroEvent, AgentTaskAssignedEvent, NewAgentSessionEvent,
};
use crate::domain::service::{AgentBotLookup, TeamMembershipLookup};

#[cfg(test)]
mod test;

/// Task facts required to open a session for an assignment.
///
/// Its own port rather than a bot fact: the task lives in the documents
/// domain, and this domain only ever asks it for a display title.
#[cfg_attr(test, mockall::automock)]
pub trait TaskDirectory: Send + Sync + 'static {
    /// The task's current title, or `None` when the task cannot be read.
    fn task_title(&self, task_id: Uuid) -> impl Future<Output = Result<Option<String>>> + Send;
}

/// Evaluates task-assignee property changes for agent assignments.
pub struct TaskAssignmentTriggerService<Bots, Teams, Tasks> {
    bots: Bots,
    teams: Teams,
    tasks: Tasks,
}

impl<Bots, Teams, Tasks> TaskAssignmentTriggerService<Bots, Teams, Tasks>
where
    Bots: AgentBotLookup,
    Teams: TeamMembershipLookup,
    Tasks: TaskDirectory,
{
    /// Creates an evaluator backed by bot, membership, and task lookups.
    pub const fn new(bots: Bots, teams: Teams, tasks: Tasks) -> Self {
        Self { bots, teams, tasks }
    }

    /// Evaluates one property event, yielding a new-session trigger for each
    /// agent that was newly assigned to a task.
    #[tracing::instrument(err, skip(self, event))]
    pub async fn evaluate(
        &self,
        event: &PropertyTopicEvent,
    ) -> Result<Vec<AgentSessionMacroEvent>> {
        let PropertyTopicEvent::EntityPropertyUpdated(update) = event else {
            return Ok(Vec::new());
        };
        if update.entity_type != EntityType::Task
            || update.property_definition_id != SystemPropertyKey::ASSIGNEES_UUID
        {
            return Ok(Vec::new());
        }
        // A write with no authenticated user is a machine migration or
        // backfill; nobody asked for a session, so nobody would own it.
        let Some(assigned_by) = update.actor_user_id.as_ref() else {
            return Ok(Vec::new());
        };
        let Ok(task_id) = Uuid::parse_str(&update.entity_id) else {
            tracing::warn!(entity_id = %update.entity_id, "task assignee event with a non-uuid entity id");
            return Ok(Vec::new());
        };

        let mut newly_assigned: Vec<BotId> = added_bot_ids(update).into_iter().collect();
        if newly_assigned.is_empty() {
            return Ok(Vec::new());
        }
        // Deterministic event order for a deterministic test surface.
        newly_assigned.sort_by_key(ToString::to_string);

        let task_title = self.tasks.task_title(task_id).await?;
        let mut events = Vec::new();
        for bot_id in newly_assigned {
            if !self.agent_assignable_by(bot_id, assigned_by).await? {
                tracing::info!(%bot_id, %task_id, "skipping a task assignment of an unavailable agent");
                continue;
            }
            events.push(AgentSessionMacroEvent::new_session(
                NewAgentSessionEvent::TaskAssigned(AgentTaskAssignedEvent {
                    bot_id,
                    task_id,
                    assigned_by: assigned_by.clone(),
                    task_title: task_title.clone(),
                }),
            ));
        }
        Ok(events)
    }

    /// Whether `assigner` may put `bot_id`'s agent to work.
    ///
    /// System agents are assignable by anyone who can edit the task.
    /// Persisted agents are assignable by their owner or their owning team's
    /// members - channel scope does not apply, because an assignment is a
    /// deliberate act on a task rather than ambient channel traffic.
    async fn agent_assignable_by(
        &self,
        bot_id: BotId,
        assigner: &MacroUserIdStr<'static>,
    ) -> Result<bool> {
        if let Some(agent) = self.bots.get_agent(bot_id).await? {
            if !agent.bot.has_agent {
                return Ok(false);
            }
            return match agent.bot.owner {
                Some(BotOwner::User { user_id }) => Ok(user_id == assigner.as_ref()),
                Some(BotOwner::Team { team_id }) => {
                    self.teams.user_has_team(assigner.clone(), team_id).await
                }
                None => Ok(false),
            };
        }
        let Some(bot) = self.bots.get_bot(bot_id).await? else {
            return Ok(false);
        };
        Ok(bot.has_agent && matches!(bot.kind, BotKind::System))
    }
}

/// The agent bot ids present in the update's value but not in its previous
/// value.
///
/// A missing previous value is treated as empty: it means the property was
/// newly attached (or the writer could not capture it), and re-triggering on
/// an agent that was already assigned is the rarer, cheaper mistake than
/// silently dropping a first assignment.
fn added_bot_ids(update: &EntityPropertyUpdatedMetadata) -> HashSet<BotId> {
    let previous = bot_ids_in(update.previous_value.as_ref());
    let mut current = bot_ids_in(update.value.as_ref());
    for bot_id in previous {
        current.remove(&bot_id);
    }
    current
}

fn bot_ids_in(value: Option<&PropertyValue>) -> HashSet<BotId> {
    let Some(PropertyValue::EntityRef(references)) = value else {
        return HashSet::new();
    };
    references
        .iter()
        .filter_map(|reference| {
            BotIdStr::parse_from_str(&reference.entity_id)
                .ok()
                .map(|bot| bot.bot_id())
        })
        .collect()
}
