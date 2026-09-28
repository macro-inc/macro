//! Initiative lifecycle facts carried by the shared event broker.

use std::{future::Future, pin::Pin};

use activity::{Actor, Attribution};
use chrono::{DateTime, Utc};
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroInitiativesTopic;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

use super::models::{AssignTasksResult, InitiativeError, InitiativeId};

/// Actor and optional delegating user retained on a committed mutation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InitiativeEventActor {
    /// Principal mechanically responsible for the mutation.
    pub actor: Actor<'static>,
    /// User who delegated the mutation to the actor, when any.
    pub on_behalf_of: Option<MacroUserIdStr<'static>>,
}

impl From<Attribution> for InitiativeEventActor {
    fn from(attribution: Attribution) -> Self {
        Self {
            actor: attribution.actor(),
            on_behalf_of: attribution.on_behalf_of(),
        }
    }
}

/// The exact before/after membership committed by the repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskMembershipChange {
    /// Task whose membership changed. Names are never stored in membership events.
    pub task_id: String,
    /// Previous initiative, absent for first assignment.
    pub from: Option<InitiativeId>,
    /// New initiative, absent for removal.
    pub to: Option<InitiativeId>,
}

/// Assignment results plus the exact committed transitions for publication.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AssignedTasks {
    /// Public per-task outcomes.
    pub results: Vec<AssignTasksResult>,
    /// Only actual changes; repeated assignment to the same project is omitted.
    pub changes: Vec<TaskMembershipChange>,
}

/// Attributed lifecycle event for one initiative.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InitiativeChange {
    /// Initiative that changed.
    pub initiative_id: InitiativeId,
    /// Actor, absent for unattributable internal operations.
    pub attribution: Option<InitiativeEventActor>,
    /// Time reported by the committed operation.
    pub occurred_at: DateTime<Utc>,
}

/// One atomic membership operation, including both sides of moves.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InitiativeTasksChanged {
    /// Actor, absent for unattributable internal operations.
    pub attribution: Option<InitiativeEventActor>,
    /// Committed membership transitions in deterministic request order.
    pub changes: Vec<TaskMembershipChange>,
    /// Time of the operation.
    pub occurred_at: DateTime<Utc>,
}

/// Events owned by initiatives. Property changes use the property domain's topic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum InitiativeTopicEvent {
    /// A project was created.
    #[serde(rename = "initiative.created")]
    Created(InitiativeChange),
    /// A project name, sharing policy, or collaborators changed.
    #[serde(rename = "initiative.updated")]
    Updated(InitiativeChange),
    /// Tasks were assigned, moved, or removed.
    #[serde(rename = "initiative.tasks_changed")]
    TasksChanged(InitiativeTasksChanged),
    /// An initiative was permanently deleted and its history must be removed.
    #[serde(rename = "initiative.purged")]
    Purged {
        /// Deleted initiative.
        initiative_id: InitiativeId,
    },
}

impl TopicEvent for InitiativeTopicEvent {
    type Topic = MacroInitiativesTopic;
    const SCHEMA_VERSION: u8 = 1;
}

/// Broker envelope keyed by the initiative that initiated the operation.
pub struct InitiativeMacroEvent {
    key: String,
    event: Event<InitiativeTopicEvent>,
}

impl InitiativeMacroEvent {
    /// Mint one stable event envelope; broker retries reuse its event id.
    pub fn new(id: InitiativeId, event: InitiativeTopicEvent) -> Self {
        Self {
            key: id.to_string(),
            event: Event::new(event),
        }
    }
}

impl MacroEvent for InitiativeMacroEvent {
    type EventPayload = InitiativeTopicEvent;
    fn key(&self) -> &str {
        &self.key
    }
    fn event(&self) -> &Event<Self::EventPayload> {
        &self.event
    }
    fn from_event(key: String, event: Event<Self::EventPayload>) -> Self {
        Self { key, event }
    }
}

/// Publication boundary called only after the initiative mutation has committed.
pub trait InitiativeEventPublisher: Send + Sync + 'static {
    /// Publish an envelope without changing its stable event identifier.
    fn publish(
        &self,
        event: InitiativeMacroEvent,
    ) -> Pin<Box<dyn Future<Output = Result<(), InitiativeError>> + Send + '_>>;
}

/// Convert a verified receipt into direct or delegated attribution.
#[cfg(feature = "ports")]
pub fn receipt_attribution<T: entity_access::domain::models::RequiredPermission>(
    receipt: &entity_access::domain::models::EntityAccessReceipt<T>,
) -> Option<InitiativeEventActor> {
    use entity_access::domain::models::EntityAccessAuth;
    match receipt.auth() {
        EntityAccessAuth::Authenticated(user) => Some(InitiativeEventActor {
            actor: Actor::new_from_user(user.clone()),
            on_behalf_of: None,
        }),
        EntityAccessAuth::Bot(bot) => Some(InitiativeEventActor {
            actor: Actor::new_from_bot(bot.bot_id()),
            on_behalf_of: bot.scope().acting_user_id().cloned(),
        }),
        EntityAccessAuth::Internal | EntityAccessAuth::Unauthenticated => None,
    }
}
