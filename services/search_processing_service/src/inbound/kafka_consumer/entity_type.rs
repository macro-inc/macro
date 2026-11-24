//! The kind of search entity a broker event acts on: the `entity_type` tag of
//! the consumer's metrics, derived from the decoded event or its topic, never
//! from an id.

use macro_event_broker::{MacroEvent, Topic as _, TopicEvent};
use strum::IntoEnumIterator as _;

use super::DeclaredMacroEvent;

/// One per subscribed topic.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr, strum::EnumIter)]
#[strum(serialize_all = "snake_case")]
pub(super) enum EntityType {
    AgentSession,
    CalendarEvent,
    Call,
    Channel,
    Chat,
    Database,
    Document,
    Email,
    Message,
    Project,
    Property,
}

/// The topic events of type `E` arrive on.
fn topic_of<E: MacroEvent>() -> &'static str {
    <<E as MacroEvent>::EventPayload as TopicEvent>::Topic::TOPIC_STR
}

impl EntityType {
    pub(super) fn of(event: &DeclaredMacroEvent) -> Self {
        match event {
            DeclaredMacroEvent::AgentSessionLifecycleMacroEvent(_) => Self::AgentSession,
            DeclaredMacroEvent::CalendarMacroEvent(_) => Self::CalendarEvent,
            DeclaredMacroEvent::CallMacroEvent(_) => Self::Call,
            DeclaredMacroEvent::ChannelMacroEvent(_) => Self::Channel,
            DeclaredMacroEvent::ChatMacroEvent(_) => Self::Chat,
            DeclaredMacroEvent::DatabaseMacroEvent(_) => Self::Database,
            DeclaredMacroEvent::DocumentMacroEvent(_) => Self::Document,
            DeclaredMacroEvent::EmailMacroEvent(_) => Self::Email,
            DeclaredMacroEvent::MessageMacroEvent(_) => Self::Message,
            DeclaredMacroEvent::ProjectMacroEvent(_) => Self::Project,
            DeclaredMacroEvent::PropertyMacroEvent(_) => Self::Property,
        }
    }

    /// The entity type of a subscribed topic's events.
    pub(super) fn from_topic(topic: &str) -> Option<Self> {
        Self::iter().find(|entity_type| entity_type.topic() == topic)
    }

    fn topic(self) -> &'static str {
        use ::agent_session::domain::events::AgentSessionLifecycleMacroEvent;
        use ::call::domain::events::CallMacroEvent;
        use ::chat::domain::events::ChatMacroEvent;
        use ::email::domain::events::EmailMacroEvent;
        use calendar_events::domain::events::CalendarMacroEvent;
        use channels::domain::broker_events::ChannelMacroEvent;
        use databases::domain::events::DatabaseMacroEvent;
        use documents::domain::events::DocumentMacroEvent;
        use messages::outbound::broker::MessageMacroEvent;
        use projects::domain::events::ProjectMacroEvent;
        use properties::domain::events::PropertyMacroEvent;

        match self {
            Self::AgentSession => topic_of::<AgentSessionLifecycleMacroEvent>(),
            Self::CalendarEvent => topic_of::<CalendarMacroEvent>(),
            Self::Call => topic_of::<CallMacroEvent>(),
            Self::Channel => topic_of::<ChannelMacroEvent>(),
            Self::Chat => topic_of::<ChatMacroEvent>(),
            Self::Database => topic_of::<DatabaseMacroEvent>(),
            Self::Document => topic_of::<DocumentMacroEvent>(),
            Self::Email => topic_of::<EmailMacroEvent>(),
            Self::Message => topic_of::<MessageMacroEvent>(),
            Self::Project => topic_of::<ProjectMacroEvent>(),
            Self::Property => topic_of::<PropertyMacroEvent>(),
        }
    }

    pub(super) fn as_str(self) -> &'static str {
        self.into()
    }
}
