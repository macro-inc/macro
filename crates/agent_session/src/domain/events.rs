//! Agent session lifecycle facts, published to
//! [`MacroAgentSessionLifecycleTopic`] and keyed by session id.
//!
//! These are facts about a session after the fact - opened, a turn started or
//! ended, nothing left to do, asking its owner something, gone - for anyone
//! downstream to react to: webhooks, notifications, observability. Commands
//! that *drive* a session travel on `macro.agent_sessions` instead.
//!
//! Consumers that only decode these events depend on this crate with
//! `default-features = false`: the domain compiles without the inbound and
//! outbound adapters' axum, sqlx, and client dependencies.

#[cfg(test)]
mod test;

use agent_runtime_protocol::domain::action::AgentActionId;
use bots::domain::models::BotId;
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroAgentSessionLifecycleTopic;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};

use super::model::{AgentSessionId, TurnId};

/// The channel thread a session was opened from, when it was.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ThreadOrigin {
    /// Channel the thread lives in.
    pub channel_id: Uuid,
    /// Root message of the thread.
    pub thread_id: Uuid,
    /// The message whose mention opened the session.
    pub originating_message_id: Uuid,
}

/// Who and what a session is; carried by every lifecycle event so a
/// consumer never has to look the session up.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct SessionIdentity {
    /// The session.
    #[cfg_attr(feature = "schema", schema(value_type = String, format = Uuid))]
    pub session_id: AgentSessionId,
    /// User-facing session name at the time of the event.
    pub session_name: String,
    /// Bot the session runs for.
    pub bot_id: BotId,
    /// The bot's display name at the time of the event.
    pub bot_name: String,
    /// User who owns the session.
    pub owner_id: MacroUserIdStr<'static>,
    /// Thread the session was opened from, when it was.
    pub origin: Option<ThreadOrigin>,
}

/// A turn the runtime answered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct TurnSummary {
    /// Position in the session's log.
    #[cfg_attr(feature = "schema", schema(value_type = u32))]
    pub turn: TurnId,
    /// The action that opened the turn.
    pub action_id: AgentActionId,
    /// User who prompted it, absent when a bot acted on nobody's behalf.
    pub actor: Option<MacroUserIdStr<'static>>,
    /// The magic-chip message posted for this turn, when one was.
    pub announcement_message_id: Option<Uuid>,
    /// The ACP stop reason, or `"error"` when the runtime refused the prompt.
    pub stop_reason: String,
    /// The agent's last text in the turn, whole; what the magic chip shows
    /// once the turn ends. `None` when the turn produced no prose.
    pub excerpt: Option<String>,
}

/// A turn the runtime never answered: the session stopped underneath it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct InFlightTurnSummary {
    /// Position in the session's log.
    #[cfg_attr(feature = "schema", schema(value_type = u32))]
    pub turn: TurnId,
    /// The action that opened the turn.
    pub action_id: AgentActionId,
    /// User who prompted it, absent when a bot acted on nobody's behalf.
    pub actor: Option<MacroUserIdStr<'static>>,
    /// The magic-chip message posted for this turn, when one was.
    pub announcement_message_id: Option<Uuid>,
}

/// A session was created.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct SessionOpenedMetadata {
    /// The session.
    pub identity: SessionIdentity,
    /// Model slug the session runs with.
    pub model: String,
    /// Harness slug the session runs on.
    pub harness: String,
}

/// A prompt was delivered to the runtime.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct TurnStartedMetadata {
    /// The session.
    pub identity: SessionIdentity,
    /// Position in the session's log.
    #[cfg_attr(feature = "schema", schema(value_type = u32))]
    pub turn: TurnId,
    /// The action that opened the turn.
    pub action_id: AgentActionId,
    /// User who prompted it, absent when a bot acted on nobody's behalf.
    pub actor: Option<MacroUserIdStr<'static>>,
    /// The magic-chip message posted for this turn, when one was.
    pub announcement_message_id: Option<Uuid>,
}

/// The runtime answered a turn. Another prompt may follow at once; see
/// [`SessionSettledMetadata`] for "nothing left to do".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct TurnEndedMetadata {
    /// The session.
    pub identity: SessionIdentity,
    /// Position in the session's log.
    #[cfg_attr(feature = "schema", schema(value_type = u32))]
    pub turn: TurnId,
    /// The action that opened the turn.
    pub action_id: AgentActionId,
    /// User who prompted it, absent when a bot acted on nobody's behalf.
    pub actor: Option<MacroUserIdStr<'static>>,
    /// The magic-chip message posted for this turn, when one was.
    pub announcement_message_id: Option<Uuid>,
    /// The ACP stop reason, or `"error"` when the runtime refused the prompt.
    pub stop_reason: String,
    /// Prompts still waiting behind this turn.
    pub queued_remaining: usize,
}

/// A turn ended and nothing is queued: the agent has stopped working.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct SessionSettledMetadata {
    /// The session.
    pub identity: SessionIdentity,
    /// The turn that just ended, when the emitter still had its record.
    pub last_turn: Option<TurnSummary>,
}

/// The agent asked its owner a question and is blocked on the answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct WaitingForInputMetadata {
    /// The session.
    pub identity: SessionIdentity,
    /// The turn asking.
    #[cfg_attr(feature = "schema", schema(value_type = u32))]
    pub turn: TurnId,
    /// The action that opened the turn.
    pub action_id: AgentActionId,
    /// The magic-chip message posted for this turn, when one was.
    pub announcement_message_id: Option<Uuid>,
    /// The question, as the agent phrased it.
    pub question: String,
}

/// The pending question was answered or withdrawn.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct InputReceivedMetadata {
    /// The session.
    pub identity: SessionIdentity,
    /// The turn that was asking.
    #[cfg_attr(feature = "schema", schema(value_type = u32))]
    pub turn: TurnId,
    /// The action that opened the turn.
    pub action_id: AgentActionId,
}

/// The session's live actor is gone: idle teardown, transport loss, or crash.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct SessionStoppedMetadata {
    /// The session.
    pub identity: SessionIdentity,
    /// Why it stopped, as the session machine reported it.
    pub reason: String,
    /// The turn that was running when it stopped, if any.
    pub turn_in_flight: Option<InFlightTurnSummary>,
}

/// The session was renamed; `identity` carries the new name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct SessionRenamedMetadata {
    /// The session, with its new name.
    pub identity: SessionIdentity,
}

/// The session was deleted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct SessionDeletedMetadata {
    /// The session as it was.
    pub identity: SessionIdentity,
}

/// Events publishable to [`MacroAgentSessionLifecycleTopic`].
///
/// The serde tag and [`AgentSessionLifecycleEventName`] spell the same wire
/// names: subscribers filter on them, so they are API. The
/// `event_names_match_the_wire` test holds the two in step. Exhaustive on
/// purpose: a consumer's match should break when a variant is added.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, strum::EnumDiscriminants)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "event_type", content = "metadata")]
#[strum_discriminants(
    name(AgentSessionLifecycleEventName),
    derive(strum::Display, strum::EnumIter, strum::IntoStaticStr),
    doc = "The wire name of an [`AgentSessionLifecycleEvent`], as subscribers filter on it."
)]
pub enum AgentSessionLifecycleEvent {
    /// A session was created.
    #[serde(rename = "agent_session.opened")]
    #[strum_discriminants(strum(serialize = "agent_session.opened"))]
    Opened(SessionOpenedMetadata),
    /// A prompt was delivered to the runtime.
    #[serde(rename = "agent_session.turn_started")]
    #[strum_discriminants(strum(serialize = "agent_session.turn_started"))]
    TurnStarted(TurnStartedMetadata),
    /// The runtime answered a turn.
    #[serde(rename = "agent_session.turn_ended")]
    #[strum_discriminants(strum(serialize = "agent_session.turn_ended"))]
    TurnEnded(TurnEndedMetadata),
    /// A turn ended with nothing queued behind it.
    #[serde(rename = "agent_session.settled")]
    #[strum_discriminants(strum(serialize = "agent_session.settled"))]
    Settled(SessionSettledMetadata),
    /// The agent is blocked on a question to its owner.
    #[serde(rename = "agent_session.waiting_for_input")]
    #[strum_discriminants(strum(serialize = "agent_session.waiting_for_input"))]
    WaitingForInput(WaitingForInputMetadata),
    /// The question was answered or withdrawn.
    #[serde(rename = "agent_session.input_received")]
    #[strum_discriminants(strum(serialize = "agent_session.input_received"))]
    InputReceived(InputReceivedMetadata),
    /// The session's live actor is gone.
    #[serde(rename = "agent_session.stopped")]
    #[strum_discriminants(strum(serialize = "agent_session.stopped"))]
    Stopped(SessionStoppedMetadata),
    /// The session was renamed.
    #[serde(rename = "agent_session.renamed")]
    #[strum_discriminants(strum(serialize = "agent_session.renamed"))]
    Renamed(SessionRenamedMetadata),
    /// The session was deleted.
    #[serde(rename = "agent_session.deleted")]
    #[strum_discriminants(strum(serialize = "agent_session.deleted"))]
    Deleted(SessionDeletedMetadata),
}

impl AgentSessionLifecycleEvent {
    /// The session this event is about.
    #[must_use]
    pub fn identity(&self) -> &SessionIdentity {
        match self {
            Self::Opened(metadata) => &metadata.identity,
            Self::TurnStarted(metadata) => &metadata.identity,
            Self::TurnEnded(metadata) => &metadata.identity,
            Self::Settled(metadata) => &metadata.identity,
            Self::WaitingForInput(metadata) => &metadata.identity,
            Self::InputReceived(metadata) => &metadata.identity,
            Self::Stopped(metadata) => &metadata.identity,
            Self::Renamed(metadata) => &metadata.identity,
            Self::Deleted(metadata) => &metadata.identity,
        }
    }

    /// The session's id.
    #[must_use]
    pub fn session_id(&self) -> AgentSessionId {
        self.identity().session_id
    }

    /// The wire name subscribers filter on.
    #[must_use]
    pub fn name(&self) -> &'static str {
        AgentSessionLifecycleEventName::from(self).into()
    }
}

impl TopicEvent for AgentSessionLifecycleEvent {
    type Topic = MacroAgentSessionLifecycleTopic;

    const SCHEMA_VERSION: u8 = 1;
}

/// Publishable event for [`MacroAgentSessionLifecycleTopic`].
///
/// Keyed by session id: one session's facts land on one partition, in order,
/// so a consumer sees `turn_started` before `turn_ended` before `settled`.
#[derive(Debug, Clone)]
pub struct AgentSessionLifecycleMacroEvent {
    key: String,
    event: Event<AgentSessionLifecycleEvent>,
}

impl AgentSessionLifecycleMacroEvent {
    /// Wrap a lifecycle fact for publication.
    #[must_use]
    pub fn new(event: AgentSessionLifecycleEvent) -> Self {
        Self {
            key: event.session_id().to_string(),
            event: Event::new(event),
        }
    }
}

impl MacroEvent for AgentSessionLifecycleMacroEvent {
    type EventPayload = AgentSessionLifecycleEvent;

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
