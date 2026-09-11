//! What counts as activity in the agent-session domain.
//!
//! Opening, prompting, and renaming are user (or delegated) acts on the
//! session. The runtime answering, asking a question, and tearing down are
//! consequences of a prompt, not acts by the subject. Deleting a session
//! removes the row, so its activities are purged like other hard deletes.

#[cfg(test)]
mod test;

use ::activity::{
    Action, Activity, ActivitySource, Actor, CommonAction, DomainActivity, EntityType, Ingest,
    event_time,
};
use macro_uuid::Uuid;

use super::events::AgentSessionLifecycleEvent;

/// Agent-session-exclusive actions. Common lifecycle actions go through
/// [`Activity::common`] and need no representation here.
#[derive(Debug, Clone, PartialEq)]
pub enum AgentSessionAction {
    /// The subject sent a prompt in the session.
    Messaged,
}

/// An agent-session-exclusive activity.
#[derive(Debug, Clone, PartialEq)]
pub struct AgentSessionActivity {
    /// The session acted on.
    pub session_id: String,
    /// What happened to it.
    pub action: AgentSessionAction,
}

impl DomainActivity for AgentSessionActivity {
    const ENTITY_TYPE: EntityType = EntityType::AgentSession;

    fn entity_id(&self) -> &str {
        &self.session_id
    }

    fn into_action(self) -> Action {
        match self.action {
            AgentSessionAction::Messaged => Action::Messaged,
        }
    }
}

impl ActivitySource for AgentSessionLifecycleEvent {
    /// Maps one `macro.agent_session_lifecycle` event to its ingest outcome.
    ///
    /// Exhaustive on purpose: a new event variant fails compilation here
    /// until someone classifies it or explicitly drops it.
    fn ingest(&self, event_id: Uuid) -> Ingest {
        let now = || event_time(event_id);
        let session_id = self.session_id().to_string();
        let owner = self.identity().owner_id.clone();
        let common = |action: CommonAction| {
            Ingest::Insert(vec![Activity::common(
                event_id,
                0,
                Actor::new_from_user(owner.clone()),
                None,
                EntityType::AgentSession,
                session_id.clone(),
                action,
                now(),
            )])
        };

        match self {
            AgentSessionLifecycleEvent::Opened(_) => common(CommonAction::Created),
            AgentSessionLifecycleEvent::TurnStarted(metadata) => match &metadata.actor {
                Some(actor) => Ingest::Insert(vec![Activity::from_domain(
                    event_id,
                    0,
                    Actor::new_from_user(actor.clone()),
                    None,
                    AgentSessionActivity {
                        session_id,
                        action: AgentSessionAction::Messaged,
                    },
                    now(),
                )]),
                None => Ingest::Ignore,
            },
            AgentSessionLifecycleEvent::Renamed(_) => common(CommonAction::Edited),
            // The session row is gone once this event is published.
            AgentSessionLifecycleEvent::Deleted(_) => {
                Ingest::Purge(vec![(EntityType::AgentSession, session_id)])
            }
            AgentSessionLifecycleEvent::TurnEnded(_)
            | AgentSessionLifecycleEvent::Settled(_)
            | AgentSessionLifecycleEvent::WaitingForInput(_)
            | AgentSessionLifecycleEvent::InputReceived(_)
            | AgentSessionLifecycleEvent::Stopped(_) => Ingest::Ignore,
        }
    }
}
