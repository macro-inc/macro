//! Maps channel lifecycle events to search-index actions and processes them.

use channels::domain::broker_events::{ChannelMacroEvent, ChannelTopicEvent};
use macro_event_broker::MacroEvent as _;
use opensearch_client::OpensearchClient;
use sqlx::PgPool;
use uuid::Uuid;

use super::{Attempted, Attempts, Handled};
use crate::process::channel::process_remove_channel_message;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ChannelIndexAction {
    RemoveChannel { channel_id: Uuid },
    Ignore,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct ChannelEventDescription {
    pub(super) action: ChannelIndexAction,
    pub(super) channel_id: Uuid,
    pub(super) event_type: &'static str,
}

pub(super) fn describe_channel_event(event: &ChannelTopicEvent) -> ChannelEventDescription {
    match event {
        ChannelTopicEvent::PictureChanged(metadata) => ChannelEventDescription {
            action: ChannelIndexAction::Ignore,
            channel_id: metadata.channel_id,
            event_type: "channel.picture_changed",
        },
        ChannelTopicEvent::Created(metadata) => ChannelEventDescription {
            action: ChannelIndexAction::Ignore,
            channel_id: metadata.channel_id,
            event_type: "channel.created",
        },
        ChannelTopicEvent::Updated(metadata) => ChannelEventDescription {
            action: ChannelIndexAction::Ignore,
            channel_id: metadata.channel_id,
            event_type: "channel.updated",
        },
        ChannelTopicEvent::Deleted(metadata) => ChannelEventDescription {
            action: ChannelIndexAction::RemoveChannel {
                channel_id: metadata.channel_id,
            },
            channel_id: metadata.channel_id,
            event_type: "channel.deleted",
        },
        ChannelTopicEvent::ParticipantAdded(metadata) => ChannelEventDescription {
            action: ChannelIndexAction::Ignore,
            channel_id: metadata.channel_id,
            event_type: "channel.participant_added",
        },
        ChannelTopicEvent::ParticipantRemoved(metadata) => ChannelEventDescription {
            action: ChannelIndexAction::Ignore,
            channel_id: metadata.channel_id,
            event_type: "channel.participant_removed",
        },
        ChannelTopicEvent::AccessRequested(metadata) => ChannelEventDescription {
            action: ChannelIndexAction::Ignore,
            channel_id: metadata.channel_id,
            event_type: "channel.access_requested",
        },
    }
}

async fn process_channel_index_action(
    opensearch_client: &OpensearchClient,
    action: ChannelIndexAction,
) -> anyhow::Result<()> {
    match action {
        ChannelIndexAction::RemoveChannel { channel_id } => {
            process_remove_channel_message(opensearch_client, channel_id, None, None).await
        }
        ChannelIndexAction::Ignore => Ok(()),
    }
}

pub(super) async fn process_channel_event(
    _db: &PgPool,
    opensearch_client: &OpensearchClient,
    event: &ChannelMacroEvent,
    partition: i32,
    offset: i64,
    attempts: &Attempts,
) -> Attempted {
    let description = describe_channel_event(&event.event().event);
    if description.action == ChannelIndexAction::Ignore {
        tracing::trace!(
            channel_id = %description.channel_id,
            event_type = description.event_type,
            partition,
            offset,
            "ignoring channel event without a search-index action"
        );
        return Ok((Handled::Ignored, 0));
    }

    attempts
        .run(|attempt| async move {
            tracing::trace!(
                channel_id = %description.channel_id,
                event_type = description.event_type,
                partition,
                offset,
                attempt,
                "processing channel search-index event"
            );
            process_channel_index_action(opensearch_client, description.action).await
        })
        .await
}
