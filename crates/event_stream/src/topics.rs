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
use activity::ActivityMacroEvent;
use agent_session::domain::events::AgentSessionLifecycleMacroEvent;
use agent_trigger::domain::broker_events::AgentSessionMacroEvent;
use bots::domain::events::BotMacroEvent;
use calendar_events::domain::events::CalendarMacroEvent;
use call::domain::events::CallMacroEvent;
use call::domain::notification_events::CallNotificationMacroEvent;
use channels::domain::broker_events::ChannelMacroEvent;
use channels::domain::mention_events::MentionMacroEvent;
use chat::domain::events::ChatMacroEvent;
use databases::domain::events::DatabaseMacroEvent;
use documents::domain::events::DocumentMacroEvent;
use email::domain::events::EmailMacroEvent;
use forms::domain::events::FormMacroEvent;
use github::broker::GithubWebhookMacroEvent;
use github_pull_requests::broker::GithubPullRequestMacroEvent;
use initiative::domain::events::InitiativeMacroEvent;
use macro_event_topics::{
    MacroAgentSessionLogTopic, MacroExampleTopic, MacroSoupRealtimeTopic, Topic,
};
use messages::outbound::broker::MessageMacroEvent;
use notification::domain::models::websocket_notification_event::JsonNotificationMacroEvent;
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
    EmailMacroEvent,
    CalendarMacroEvent,
    ActivityMacroEvent,
    JsonNotificationMacroEvent,
    MentionMacroEvent,
    TeamMacroEvent,
    BotMacroEvent,
    GithubWebhookMacroEvent,
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
    EmailMacroEvent,
    CalendarMacroEvent,
    ActivityMacroEvent,
    JsonNotificationMacroEvent,
    MentionMacroEvent,
    TeamMacroEvent,
    BotMacroEvent,
    GithubWebhookMacroEvent,
);

/// Internal topics the `public-event-log` writer also reads because their
/// events change access: it appends the invalidation, not the event.
/// [`LogMacroEvent`] is [`DeclaredMacroEvent`] plus these. Empty while every
/// access-changing topic (teams, bots, channels, documents) is public, since
/// public topics are read anyway.
pub const ACCESS_CHANGE_TOPICS: &[&str] = &[];

/// Topics neither delivery reads. Each topic in `macro_event_topics` is
/// either subscribed above or listed here, so a new topic fails the coverage
/// test until someone decides. A topic stays here only while no event on it
/// declares [`Exposure::Public`](macro_event_broker::exposure::Exposure::Public)
/// (it carries projections, app cache signals or nothing at all); when one
/// does, move the topic to both declarations above and register its names in
/// the catalog.
pub const INTERNAL_TOPICS: &[&str] = &[
    MacroExampleTopic::TOPIC_STR,
    MacroSoupRealtimeTopic::TOPIC_STR,
    // Retired; no event type exists in this repository any more.
    MacroAgentSessionLogTopic::TOPIC_STR,
];
