//! The broker topics carrying public events.
//!
//! One declaration shared by both consumers of public events: webhook
//! ingestion reads [`DeclaredMacroEvent`], the `public-event-log` writer
//! (live streams) reads the same topics plus the internal ones whose events
//! change access ([`LogMacroEvent`]), so the two can never drift onto
//! different public topic sets.

#[cfg(test)]
mod test;

use crate::domain::webhook_lifecycle::WebhookMacroEvent;
use agent_session::domain::events::AgentSessionLifecycleMacroEvent;
use agent_trigger::domain::broker_events::AgentSessionMacroEvent;
use bots::domain::events::BotMacroEvent;
use call::domain::events::CallMacroEvent;
use call::domain::notification_events::CallNotificationMacroEvent;
use channels::domain::broker_events::ChannelMacroEvent;
use chat::domain::events::ChatMacroEvent;
use databases::domain::events::DatabaseMacroEvent;
use documents::domain::events::DocumentMacroEvent;
use forms::domain::events::FormMacroEvent;
use github_pull_requests::broker::GithubPullRequestMacroEvent;
use initiative::domain::events::InitiativeMacroEvent;
use macro_event_topics::{
    MacroActivityTopic, MacroAgentSessionLogTopic, MacroBotsTopic, MacroCalendarTopic,
    MacroEmailTopic, MacroExampleTopic, MacroGithubWebhooksTopic, MacroMentionsTopic,
    MacroNotificationsTopic, MacroSoupRealtimeTopic, MacroTeamsTopic, Topic,
};
use messages::outbound::broker::MessageMacroEvent;
use projects::domain::events::ProjectMacroEvent;
use properties::domain::events::PropertyMacroEvent;
use teams::domain::events::TeamMacroEvent;
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
    ProjectMacroEvent,
    ChatMacroEvent,
    DatabaseMacroEvent,
    FormMacroEvent,
    InitiativeMacroEvent,
    PropertyMacroEvent,
    CallMacroEvent,
    GithubPullRequestMacroEvent,
);

macro_event_broker::declare_topics!(
    LogMacroEvent: DocumentMacroEvent,
    ChannelMacroEvent,
    CallNotificationMacroEvent,
    MessageMacroEvent,
    WebhookMacroEvent,
    AgentSessionMacroEvent,
    AgentSessionLifecycleMacroEvent,
    UserMacroEvent,
    ProjectMacroEvent,
    ChatMacroEvent,
    DatabaseMacroEvent,
    FormMacroEvent,
    InitiativeMacroEvent,
    PropertyMacroEvent,
    CallMacroEvent,
    GithubPullRequestMacroEvent,
    TeamMacroEvent,
    BotMacroEvent,
);

/// Internal topics the `public-event-log` writer also reads because their
/// events change access (team membership, bot deletion): it appends the
/// invalidation, not the event. [`LogMacroEvent`] is [`DeclaredMacroEvent`]
/// plus these.
pub const ACCESS_CHANGE_TOPICS: &[&str] = &[MacroTeamsTopic::TOPIC_STR, MacroBotsTopic::TOPIC_STR];

/// Topics nothing delivers by webhook or stream: every event on them declares
/// [`Exposure::Internal`](macro_event_broker::exposure::Exposure::Internal)
/// today. Each topic in `macro_event_topics` is either subscribed above or
/// listed here, so a new topic fails the coverage test until someone decides.
/// When a family turns public, move its topic from here to the declaration
/// above.
pub const INTERNAL_TOPICS: &[&str] = &[
    MacroExampleTopic::TOPIC_STR,
    MacroBotsTopic::TOPIC_STR,
    MacroGithubWebhooksTopic::TOPIC_STR,
    MacroSoupRealtimeTopic::TOPIC_STR,
    MacroTeamsTopic::TOPIC_STR,
    MacroEmailTopic::TOPIC_STR,
    MacroMentionsTopic::TOPIC_STR,
    MacroNotificationsTopic::TOPIC_STR,
    MacroActivityTopic::TOPIC_STR,
    MacroCalendarTopic::TOPIC_STR,
    // Retired; no event type exists in this repository any more.
    MacroAgentSessionLogTopic::TOPIC_STR,
];
