//! Which cached access facts a broker event changes.
//!
//! Appended to the public event log with the event (or alone, for internal
//! events) so every process evicts them before delivering anything after.

use crate::domain::models::{Invalidation, LogRecord};
use crate::domain::normalize::{NormalizeError, normalize};
use crate::topics::LogMacroEvent;
use bots::domain::events::BotTopicEvent;
use channels::domain::broker_events::ChannelTopicEvent;
use documents::domain::events::DocumentTopicEvent;
use event_exposure::EntityType;
use macro_event_broker::MacroEvent as _;
use teams::domain::events::TeamTopicEvent;

/// The access facts `event` changes.
pub fn invalidations(event: &LogMacroEvent) -> Vec<Invalidation> {
    match event {
        LogMacroEvent::DocumentMacroEvent(event) => match &event.event().event {
            DocumentTopicEvent::Updated(metadata) if metadata.share_permission_updated => {
                vec![Invalidation::Entity {
                    entity_type: EntityType::Document,
                    entity_id: metadata.document_id.clone(),
                }]
            }
            _ => Vec::new(),
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
        | LogMacroEvent::UserMacroEvent(_) => Vec::new(),
    }
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
