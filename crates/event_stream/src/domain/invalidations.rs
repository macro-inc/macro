//! Which cached access facts a broker event changes.
//!
//! Appended to the public event log with the event (or alone, for internal
//! events) so every process evicts them before delivering anything after.

#[cfg(test)]
mod test;

use crate::domain::models::{Invalidation, LogRecord};
use crate::domain::normalize::{NormalizeError, normalize};
use crate::topics::LogMacroEvent;
use bots::domain::events::BotTopicEvent;
use channels::domain::broker_events::ChannelTopicEvent;
use chat::domain::events::ChatTopicEvent;
use databases::domain::events::DatabaseTopicEvent;
use documents::domain::events::DocumentTopicEvent;
use event_exposure::EntityType;
use forms::domain::events::FormTopicEvent;
use initiative::domain::events::InitiativeTopicEvent;
use macro_event_broker::MacroEvent as _;
use projects::domain::events::ProjectTopicEvent;
use teams::domain::events::TeamTopicEvent;

/// The access facts `event` changes.
pub fn invalidations(event: &LogMacroEvent) -> Vec<Invalidation> {
    match event {
        // Sharing an entity with a channel (`shareWithChannel`, a message
        // reference) publishes no event, and the producers' share flags miss
        // it, so every structural event of a shareable entity evicts it: the
        // next event about it, such as a rename after a share, is resolved
        // against current access. High-frequency events (interactions,
        // content saves, table writes, responses, chat messages) do not
        // evict; their entity's cache lapses in 5 s at most.
        LogMacroEvent::DocumentMacroEvent(event) => match &event.event().event {
            DocumentTopicEvent::Created(metadata) => {
                entity(EntityType::Document, &metadata.document_id)
            }
            DocumentTopicEvent::Updated(metadata) => {
                entity(EntityType::Document, &metadata.document_id)
            }
            DocumentTopicEvent::Copied(metadata) => {
                entity(EntityType::Document, &metadata.document_id)
            }
            DocumentTopicEvent::Deleted(_)
            | DocumentTopicEvent::ContentUploaded(_)
            | DocumentTopicEvent::SyncContentUpdated(_)
            | DocumentTopicEvent::Purged(_)
            | DocumentTopicEvent::Interaction(_) => Vec::new(),
        },
        LogMacroEvent::ProjectMacroEvent(event) => match &event.event().event {
            ProjectTopicEvent::Created(metadata) => {
                entity(EntityType::Project, &metadata.project_id)
            }
            ProjectTopicEvent::Updated(metadata) => {
                entity(EntityType::Project, &metadata.project_id)
            }
            ProjectTopicEvent::Restored(metadata) => {
                entity(EntityType::Project, &metadata.project_id)
            }
            ProjectTopicEvent::Uploaded(metadata) => {
                entity(EntityType::Project, &metadata.root_project_id)
            }
            ProjectTopicEvent::Deleted(_) | ProjectTopicEvent::PermanentlyDeleted(_) => Vec::new(),
        },
        LogMacroEvent::ChatMacroEvent(event) => match &event.event().event {
            ChatTopicEvent::Created(metadata) => entity(EntityType::Chat, &metadata.chat_id),
            ChatTopicEvent::Updated(metadata) => entity(EntityType::Chat, &metadata.chat_id),
            ChatTopicEvent::Restored(metadata) => entity(EntityType::Chat, &metadata.chat_id),
            ChatTopicEvent::Copied(metadata) => entity(EntityType::Chat, &metadata.chat_id),
            ChatTopicEvent::Deleted(_)
            | ChatTopicEvent::PermanentlyDeleted(_)
            | ChatTopicEvent::MessageSent(_)
            | ChatTopicEvent::MessageDeleted(_) => Vec::new(),
        },
        LogMacroEvent::DatabaseMacroEvent(event) => match &event.event().event {
            DatabaseTopicEvent::Created(metadata) => {
                entity(EntityType::Database, metadata.database_id)
            }
            DatabaseTopicEvent::Renamed(metadata) => {
                entity(EntityType::Database, metadata.database_id)
            }
            DatabaseTopicEvent::Restored(metadata) => {
                entity(EntityType::Database, metadata.database_id)
            }
            DatabaseTopicEvent::SharingChanged(metadata) => {
                entity(EntityType::Database, metadata.database_id)
            }
            DatabaseTopicEvent::AppearanceChanged { database_id, .. } => {
                entity(EntityType::Database, database_id)
            }
            DatabaseTopicEvent::Trashed(_)
            | DatabaseTopicEvent::Purged(_)
            | DatabaseTopicEvent::TablesChanged(_) => Vec::new(),
        },
        LogMacroEvent::FormMacroEvent(event) => match &event.event().event {
            FormTopicEvent::Created(metadata) => entity(EntityType::Form, metadata.form_id),
            FormTopicEvent::Renamed(metadata) => entity(EntityType::Form, metadata.form_id),
            FormTopicEvent::Restored(metadata) => entity(EntityType::Form, metadata.form_id),
            FormTopicEvent::SharingChanged(metadata) => entity(EntityType::Form, metadata.form_id),
            FormTopicEvent::AppearanceChanged { form_id, .. } => entity(EntityType::Form, form_id),
            FormTopicEvent::Trashed(_)
            | FormTopicEvent::Purged(_)
            | FormTopicEvent::ResponseSubmitted(_) => Vec::new(),
        },
        LogMacroEvent::InitiativeMacroEvent(event) => match &event.event().event {
            InitiativeTopicEvent::Created(change) | InitiativeTopicEvent::Updated(change) => {
                entity(EntityType::Initiative, change.initiative_id)
            }
            InitiativeTopicEvent::AppearanceChanged { change, .. } => {
                entity(EntityType::Initiative, change.initiative_id)
            }
            InitiativeTopicEvent::Purged { .. } => Vec::new(),
        },
        LogMacroEvent::ChannelMacroEvent(event) => match &event.event().event {
            ChannelTopicEvent::ParticipantAdded(metadata) => channel(metadata.channel_id),
            ChannelTopicEvent::ParticipantRemoved(metadata) => channel(metadata.channel_id),
            ChannelTopicEvent::Deleted(metadata) => channel(metadata.channel_id),
            ChannelTopicEvent::Created(_)
            | ChannelTopicEvent::Updated(_)
            | ChannelTopicEvent::PictureChanged(_)
            | ChannelTopicEvent::AccessRequested(_) => Vec::new(),
        },
        LogMacroEvent::TeamMacroEvent(event) => match &event.event().event {
            TeamTopicEvent::MemberJoined(metadata) => vec![Invalidation::Team {
                team_id: metadata.team_id,
                user_id: Some(metadata.member_id.clone()),
            }],
            TeamTopicEvent::MemberRemoved(metadata) => vec![Invalidation::Team {
                team_id: metadata.team_id,
                user_id: Some(metadata.member_id.clone()),
            }],
            TeamTopicEvent::MemberRoleChanged(metadata) => vec![Invalidation::Team {
                team_id: metadata.team_id,
                user_id: Some(metadata.member_id.clone()),
            }],
            TeamTopicEvent::Deleted(metadata) => vec![Invalidation::Team {
                team_id: metadata.team_id,
                user_id: None,
            }],
            TeamTopicEvent::Created(_)
            | TeamTopicEvent::Updated(_)
            | TeamTopicEvent::InviteCreated(_)
            | TeamTopicEvent::InviteRejected(_)
            | TeamTopicEvent::InviteRevoked(_)
            | TeamTopicEvent::AutoJoinDomainToggled(_) => Vec::new(),
        },
        LogMacroEvent::BotMacroEvent(event) => match &event.event().event {
            BotTopicEvent::Deleted(metadata) => vec![Invalidation::BotDeleted {
                bot_id: metadata.bot_id.as_uuid(),
            }],
            BotTopicEvent::Created(_) | BotTopicEvent::Updated(_) => Vec::new(),
        },
        LogMacroEvent::CallNotificationMacroEvent(_)
        | LogMacroEvent::MessageMacroEvent(_)
        | LogMacroEvent::WebhookMacroEvent(_)
        | LogMacroEvent::AgentSessionMacroEvent(_)
        | LogMacroEvent::AgentSessionLifecycleMacroEvent(_)
        | LogMacroEvent::UserMacroEvent(_)
        | LogMacroEvent::PropertyMacroEvent(_)
        | LogMacroEvent::CallMacroEvent(_)
        | LogMacroEvent::GithubPullRequestMacroEvent(_)
        | LogMacroEvent::EmailMacroEvent(_)
        | LogMacroEvent::CalendarMacroEvent(_)
        | LogMacroEvent::ActivityMacroEvent(_)
        | LogMacroEvent::JsonNotificationMacroEvent(_)
        | LogMacroEvent::MentionMacroEvent(_)
        | LogMacroEvent::GithubWebhookMacroEvent(_) => Vec::new(),
    }
}

fn entity(entity_type: EntityType, entity_id: impl ToString) -> Vec<Invalidation> {
    vec![Invalidation::Entity {
        entity_type,
        entity_id: entity_id.to_string(),
    }]
}

fn channel(channel_id: impl ToString) -> Vec<Invalidation> {
    vec![Invalidation::Entity {
        entity_type: EntityType::Channel,
        entity_id: channel_id.to_string(),
    }]
}

/// The log record for one decoded event: its public form, if any, and the
/// access facts it changes. `None` when it has neither.
pub fn log_record(event: &LogMacroEvent) -> Result<Option<LogRecord>, NormalizeError> {
    let public = match event {
        LogMacroEvent::DocumentMacroEvent(event) => normalize(event.event())?,
        LogMacroEvent::ChannelMacroEvent(event) => normalize(event.event())?,
        LogMacroEvent::CallNotificationMacroEvent(event) => normalize(event.event())?,
        LogMacroEvent::MessageMacroEvent(event) => normalize(event.event())?,
        LogMacroEvent::WebhookMacroEvent(event) => normalize(event.event())?,
        LogMacroEvent::AgentSessionMacroEvent(event) => normalize(event.event())?,
        LogMacroEvent::AgentSessionLifecycleMacroEvent(event) => normalize(event.event())?,
        LogMacroEvent::UserMacroEvent(event) => normalize(event.event())?,
        LogMacroEvent::ProjectMacroEvent(event) => normalize(event.event())?,
        LogMacroEvent::ChatMacroEvent(event) => normalize(event.event())?,
        LogMacroEvent::DatabaseMacroEvent(event) => normalize(event.event())?,
        LogMacroEvent::FormMacroEvent(event) => normalize(event.event())?,
        LogMacroEvent::InitiativeMacroEvent(event) => normalize(event.event())?,
        LogMacroEvent::PropertyMacroEvent(event) => normalize(event.event())?,
        LogMacroEvent::CallMacroEvent(event) => normalize(event.event())?,
        LogMacroEvent::GithubPullRequestMacroEvent(event) => normalize(event.event())?,
        LogMacroEvent::EmailMacroEvent(event) => normalize(event.event())?,
        LogMacroEvent::CalendarMacroEvent(event) => normalize(event.event())?,
        LogMacroEvent::ActivityMacroEvent(event) => normalize(event.event())?,
        LogMacroEvent::JsonNotificationMacroEvent(event) => normalize(event.event())?,
        LogMacroEvent::MentionMacroEvent(event) => normalize(event.event())?,
        LogMacroEvent::GithubWebhookMacroEvent(event) => normalize(event.event())?,
        LogMacroEvent::TeamMacroEvent(event) => normalize(event.event())?,
        LogMacroEvent::BotMacroEvent(event) => normalize(event.event())?,
    };
    let invalidations = invalidations(event);
    if public.is_none() && invalidations.is_empty() {
        return Ok(None);
    }
    Ok(Some(LogRecord {
        event: public,
        invalidations,
    }))
}
