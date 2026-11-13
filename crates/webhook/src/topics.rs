//! The broker topics the webhook system subscribes to.
//!
//! One declaration shared by both consumption paths — the durable ingestion
//! consumer (`inbound::kafka_consumer`) and the process-level SSE consumer
//! (`inbound::kafka_stream_consumer`) — so the two can never drift onto
//! different topic sets.

#[cfg(test)]
mod test;

use crate::domain::events::WebhookMacroEvent;
use agent_session::domain::events::AgentSessionLifecycleMacroEvent;
use agent_trigger::domain::broker_events::AgentSessionMacroEvent;
use call::domain::notification_events::CallNotificationMacroEvent;
use channels::domain::broker_events::ChannelMacroEvent;
use documents::domain::events::DocumentMacroEvent;
use macro_event_topics::{
    MacroActivityTopic, MacroAgentSessionLogTopic, MacroBotsTopic, MacroCalendarTopic,
    MacroCallsTopic, MacroChatsTopic, MacroDatabasesTopic, MacroEmailTopic, MacroExampleTopic,
    MacroFormsTopic, MacroGithubPullRequestsTopic, MacroGithubWebhooksTopic, MacroInitiativesTopic,
    MacroMentionsTopic, MacroNotificationsTopic, MacroProjectsTopic, MacroPropertiesTopic,
    MacroSoupRealtimeTopic, MacroTeamsTopic, Topic,
};
use messages::outbound::broker::MessageMacroEvent;
use user_events::UserMacroEvent;

macro_event_broker::declare_topics!(
    DeclaredMacroEvent: DocumentMacroEvent,
    ChannelMacroEvent,
    CallNotificationMacroEvent,
    MessageMacroEvent,
    WebhookMacroEvent,
    AgentSessionMacroEvent,
    AgentSessionLifecycleMacroEvent,
    UserMacroEvent,
);

/// Topics nothing delivers by webhook or stream: every event on them declares
/// [`Exposure::Internal`](macro_event_broker::exposure::Exposure::Internal)
/// today. Each topic in `macro_event_topics` is either subscribed above or
/// listed here, so a new topic fails the coverage test until someone decides.
/// When a family turns public, move its topic from here to the declaration
/// above.
pub const INTERNAL_TOPICS: &[&str] = &[
    MacroExampleTopic::TOPIC_STR,
    MacroBotsTopic::TOPIC_STR,
    MacroCallsTopic::TOPIC_STR,
    MacroGithubPullRequestsTopic::TOPIC_STR,
    MacroGithubWebhooksTopic::TOPIC_STR,
    MacroSoupRealtimeTopic::TOPIC_STR,
    MacroProjectsTopic::TOPIC_STR,
    MacroInitiativesTopic::TOPIC_STR,
    MacroPropertiesTopic::TOPIC_STR,
    MacroTeamsTopic::TOPIC_STR,
    MacroEmailTopic::TOPIC_STR,
    MacroMentionsTopic::TOPIC_STR,
    MacroNotificationsTopic::TOPIC_STR,
    MacroActivityTopic::TOPIC_STR,
    MacroChatsTopic::TOPIC_STR,
    MacroCalendarTopic::TOPIC_STR,
    // Retired; no event type exists in this repository any more.
    MacroAgentSessionLogTopic::TOPIC_STR,
    MacroDatabasesTopic::TOPIC_STR,
    MacroFormsTopic::TOPIC_STR,
];
