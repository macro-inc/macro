//! Maps message facts to search-index actions and processes them.
//!
//! Channel messages are indexed; document discussions are not, so facts with
//! a document parent are ignored here.

use macro_event_broker::MacroEvent as _;
use messages::domain::models::MessageParent;
use messages::outbound::broker::{MessageMacroEvent, MessageTopicEvent};
use opensearch_client::OpensearchClient;
use sqlx::PgPool;
use uuid::Uuid;

use super::{Attempted, Attempts, Handled};
use crate::process::channel::{
    ChannelMessageUpdate, process_channel_message_update, process_remove_channel_message,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum MessageIndexAction {
    UpsertMessage { channel_id: Uuid, message_id: Uuid },
    RemoveMessage { channel_id: Uuid, message_id: Uuid },
    Ignore,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct MessageEventDescription {
    pub(super) action: MessageIndexAction,
    pub(super) parent: MessageParent,
    pub(super) event_type: &'static str,
}

fn channel_id(parent: &MessageParent) -> Option<Uuid> {
    match parent {
        MessageParent::Channel(channel_id) => Some(*channel_id),
        _ => None,
    }
}

fn upsert(parent: &MessageParent, message_id: Uuid) -> MessageIndexAction {
    channel_id(parent).map_or(MessageIndexAction::Ignore, |channel_id| {
        MessageIndexAction::UpsertMessage {
            channel_id,
            message_id,
        }
    })
}

pub(super) fn describe_message_event(event: &MessageTopicEvent) -> MessageEventDescription {
    match event {
        MessageTopicEvent::Posted(metadata) => MessageEventDescription {
            action: upsert(&metadata.parent, metadata.message_id),
            parent: metadata.parent.clone(),
            event_type: "message.posted",
        },
        // Mentions carry no index change beyond the posted fact emitted
        // alongside them.
        MessageTopicEvent::Mentioned(metadata) => MessageEventDescription {
            action: MessageIndexAction::Ignore,
            parent: metadata.parent.clone(),
            event_type: "message.mentioned",
        },
        MessageTopicEvent::Patched(metadata) => MessageEventDescription {
            action: upsert(&metadata.parent, metadata.message_id),
            parent: metadata.parent.clone(),
            event_type: "message.patched",
        },
        MessageTopicEvent::Deleted(metadata) => MessageEventDescription {
            action: channel_id(&metadata.parent).map_or(MessageIndexAction::Ignore, |channel_id| {
                MessageIndexAction::RemoveMessage {
                    channel_id,
                    message_id: metadata.message_id,
                }
            }),
            parent: metadata.parent.clone(),
            event_type: "message.deleted",
        },
        MessageTopicEvent::AttachmentCreated(metadata) => MessageEventDescription {
            action: upsert(&metadata.parent, metadata.message_id),
            parent: metadata.parent.clone(),
            event_type: "message.attachment_created",
        },
        MessageTopicEvent::AttachmentRemoved(metadata) => MessageEventDescription {
            action: upsert(&metadata.parent, metadata.message_id),
            parent: metadata.parent.clone(),
            event_type: "message.attachment_removed",
        },
    }
}

async fn process_message_index_action(
    db: &PgPool,
    opensearch_client: &OpensearchClient,
    action: MessageIndexAction,
) -> anyhow::Result<Handled> {
    match action {
        MessageIndexAction::UpsertMessage {
            channel_id,
            message_id,
        } => Ok(
            match process_channel_message_update(
                opensearch_client,
                db,
                channel_id,
                message_id,
                None,
            )
            .await?
            {
                ChannelMessageUpdate::Applied => Handled::Indexed,
                ChannelMessageUpdate::ChannelGone => Handled::SourceMissing,
            },
        ),
        MessageIndexAction::RemoveMessage {
            channel_id,
            message_id,
        } => {
            process_remove_channel_message(opensearch_client, channel_id, Some(message_id), None)
                .await?;
            Ok(Handled::Indexed)
        }
        MessageIndexAction::Ignore => Ok(Handled::Ignored),
    }
}

pub(super) async fn process_message_event(
    db: &PgPool,
    opensearch_client: &OpensearchClient,
    event: &MessageMacroEvent,
    partition: i32,
    offset: i64,
    attempts: &Attempts,
) -> Attempted {
    let description = describe_message_event(&event.event().event);
    if description.action == MessageIndexAction::Ignore {
        tracing::trace!(
            parent = ?description.parent,
            event_type = description.event_type,
            partition,
            offset,
            "ignoring message event without a search-index action"
        );
        return Ok((Handled::Ignored, 0));
    }

    let action = description.action;
    attempts
        .run_handled(|attempt| {
            let description = &description;
            async move {
                tracing::trace!(
                    parent = ?description.parent,
                    event_type = description.event_type,
                    partition,
                    offset,
                    attempt,
                    "processing message search-index event"
                );
                process_message_index_action(db, opensearch_client, action).await
            }
        })
        .await
}
