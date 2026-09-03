//! Stream-candidate adapters over shared webhook event normalization.

use super::{
    WebhookEventIngestionError, normalized_agent_trigger_event, normalized_channel_event,
    normalized_document_event, normalized_webhook_event,
};
use crate::domain::{
    events::WebhookTopicEvent,
    stream::{StreamAudience, StreamCandidateEvent},
};
use agent_trigger::domain::broker_events::AgentTriggerTopicEvent;
use channels::domain::broker_events::ChannelTopicEvent;
use documents::domain::events::DocumentTopicEvent;
use entity_access::domain::models::EntityType;
use macro_event_broker::Event;

pub(crate) fn document_stream_candidate(
    event: &Event<DocumentTopicEvent>,
) -> Result<Option<StreamCandidateEvent>, WebhookEventIngestionError> {
    Ok(
        normalized_document_event(event)?.map(|normalized| StreamCandidateEvent {
            audience: StreamAudience::Entity {
                entity_id: normalized.entity_id.clone(),
                entity_type: EntityType::Document,
            },
            event: normalized,
        }),
    )
}

pub(crate) fn channel_stream_candidate(
    event: &Event<ChannelTopicEvent>,
) -> Result<StreamCandidateEvent, WebhookEventIngestionError> {
    let normalized = normalized_channel_event(event)?;
    Ok(StreamCandidateEvent {
        audience: StreamAudience::Entity {
            entity_id: normalized.entity_id.clone(),
            entity_type: EntityType::Channel,
        },
        event: normalized,
    })
}

pub(crate) fn webhook_stream_candidate(
    event: &Event<WebhookTopicEvent>,
) -> Result<StreamCandidateEvent, WebhookEventIngestionError> {
    let (normalized, workspace_id) = normalized_webhook_event(event)?;
    Ok(StreamCandidateEvent {
        audience: StreamAudience::Workspace { workspace_id },
        event: normalized,
    })
}

pub(crate) fn agent_trigger_stream_candidate(
    event: &Event<AgentTriggerTopicEvent>,
) -> Result<StreamCandidateEvent, WebhookEventIngestionError> {
    let (normalized, audience) = normalized_agent_trigger_event(event)?;
    Ok(StreamCandidateEvent {
        audience: StreamAudience::Entity {
            entity_id: audience.entity_id,
            entity_type: audience.entity_type,
        },
        event: normalized,
    })
}
