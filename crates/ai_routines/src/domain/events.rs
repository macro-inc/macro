//! Run requests for AI routines, published to [`MacroAiRoutinesTopic`] and
//! keyed by routine id.
//!
//! A request carries the whole routine definition, so a consumer can start the
//! run without reading the scheduler's tables: the scheduler stays the owner of
//! *when* a routine fires, and the consumer owns *how* it runs.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroAiRoutinesTopic;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};

/// What asked for the run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiRoutineTrigger {
    /// The routine's cron schedule came due.
    Schedule,
    /// The owner asked for a run now.
    Manual,
}

/// A request to run one routine once.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AiRoutineRunRequested {
    /// The routine, as the scheduler stores it.
    pub routine_id: Uuid,
    /// The user who owns the routine and is credited for the run.
    pub owner: MacroUserIdStr<'static>,
    /// The routine's display name.
    pub name: String,
    /// The model the routine was configured with.
    pub model: String,
    /// Session this firing opens.
    pub session_id: Uuid,
    /// Standing instructions for the run: the routine's system prompt.
    pub prompt: String,
    /// The first message of the run: the routine's user prompt.
    pub user_prompt: String,
    /// When the request was made.
    pub requested_at: DateTime<Utc>,
    /// What asked for the run.
    pub trigger: AiRoutineTrigger,
}

/// Events publishable to [`MacroAiRoutinesTopic`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum AiRoutineTopicEvent {
    /// Run a routine now.
    #[serde(rename = "ai_routine.run_requested")]
    RunRequested(AiRoutineRunRequested),
}

impl AiRoutineTopicEvent {
    /// The routine this event is about.
    #[must_use]
    pub fn routine_id(&self) -> Uuid {
        match self {
            Self::RunRequested(request) => request.routine_id,
        }
    }

    /// The wire name of this event, as the serde tag spells it.
    #[must_use]
    pub fn name(&self) -> &'static str {
        match self {
            Self::RunRequested(_) => "ai_routine.run_requested",
        }
    }
}

impl TopicEvent for AiRoutineTopicEvent {
    type Topic = MacroAiRoutinesTopic;

    const SCHEMA_VERSION: u8 = 1;
}

/// Publishable event for [`MacroAiRoutinesTopic`].
///
/// Keyed by routine id: one routine's requests land on one partition, in
/// order, so a consumer sees them in the order they were made.
#[derive(Debug, Clone)]
pub struct AiRoutineMacroEvent {
    key: String,
    event: Event<AiRoutineTopicEvent>,
}

impl AiRoutineMacroEvent {
    /// Request one run of a routine.
    #[must_use]
    pub fn run_requested(request: AiRoutineRunRequested) -> Self {
        Self::new(AiRoutineTopicEvent::RunRequested(request))
    }

    /// Wrap a routine event for publication.
    #[must_use]
    pub fn new(event: AiRoutineTopicEvent) -> Self {
        Self {
            key: event.routine_id().to_string(),
            event: Event::new(event),
        }
    }
}

impl MacroEvent for AiRoutineMacroEvent {
    type EventPayload = AiRoutineTopicEvent;

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
