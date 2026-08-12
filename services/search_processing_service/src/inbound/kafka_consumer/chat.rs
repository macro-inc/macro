//! Maps chat lifecycle events to search-index actions and processes them.

use ::chat::domain::events::{ChatMacroEvent, ChatTopicEvent};
use macro_event_broker::MacroEvent as _;
use opensearch_client::OpensearchClient;
use sqlx::PgPool;

use super::{EventOutcome, MAX_PROCESSING_ATTEMPTS, PROCESSING_RETRY_BASE_DELAY, retry_processing};
use crate::process::chat::{remove_chat_message, upsert_chat_message_by_ids};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ChatIndexAction<'a> {
    UpsertMessage {
        chat_id: &'a str,
        message_id: &'a str,
    },
    RemoveMessage {
        chat_id: &'a str,
        message_id: &'a str,
    },
    RemoveChat {
        chat_id: &'a str,
    },
    Ignore,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct ChatEventDescription<'a> {
    pub(super) action: ChatIndexAction<'a>,
    pub(super) chat_id: &'a str,
    pub(super) event_type: &'static str,
}

pub(super) fn describe_chat_event(event: &ChatTopicEvent) -> ChatEventDescription<'_> {
    match event {
        ChatTopicEvent::Created(metadata) => ChatEventDescription {
            action: ChatIndexAction::Ignore,
            chat_id: &metadata.chat_id,
            event_type: "chat.created",
        },
        ChatTopicEvent::Updated(metadata) => ChatEventDescription {
            action: ChatIndexAction::Ignore,
            chat_id: &metadata.chat_id,
            event_type: "chat.updated",
        },
        ChatTopicEvent::Deleted(metadata) => ChatEventDescription {
            action: ChatIndexAction::Ignore,
            chat_id: &metadata.chat_id,
            event_type: "chat.deleted",
        },
        ChatTopicEvent::PermanentlyDeleted(metadata) => ChatEventDescription {
            action: ChatIndexAction::RemoveChat {
                chat_id: &metadata.chat_id,
            },
            chat_id: &metadata.chat_id,
            event_type: "chat.permanently_deleted",
        },
        ChatTopicEvent::Restored(metadata) => ChatEventDescription {
            action: ChatIndexAction::Ignore,
            chat_id: &metadata.chat_id,
            event_type: "chat.restored",
        },
        ChatTopicEvent::Copied(metadata) => ChatEventDescription {
            action: ChatIndexAction::Ignore,
            chat_id: &metadata.chat_id,
            event_type: "chat.copied",
        },
        ChatTopicEvent::MessageSent(metadata) => ChatEventDescription {
            action: ChatIndexAction::UpsertMessage {
                chat_id: &metadata.chat_id,
                message_id: &metadata.message_id,
            },
            chat_id: &metadata.chat_id,
            event_type: "chat.message_sent",
        },
        ChatTopicEvent::MessageDeleted(metadata) => ChatEventDescription {
            action: ChatIndexAction::RemoveMessage {
                chat_id: &metadata.chat_id,
                message_id: &metadata.message_id,
            },
            chat_id: &metadata.chat_id,
            event_type: "chat.message_deleted",
        },
    }
}

async fn process_chat_index_action(
    db: &PgPool,
    opensearch_client: &OpensearchClient,
    action: ChatIndexAction<'_>,
) -> anyhow::Result<()> {
    match action {
        ChatIndexAction::UpsertMessage {
            chat_id,
            message_id,
        } => upsert_chat_message_by_ids(opensearch_client, db, chat_id, message_id, None).await,
        ChatIndexAction::RemoveMessage {
            chat_id,
            message_id,
        } => remove_chat_message(opensearch_client, chat_id, Some(message_id), None).await,
        ChatIndexAction::RemoveChat { chat_id } => {
            remove_chat_message(opensearch_client, chat_id, None, None).await
        }
        ChatIndexAction::Ignore => Ok(()),
    }
}

pub(super) async fn process_chat_event(
    db: &PgPool,
    opensearch_client: &OpensearchClient,
    event: &ChatMacroEvent,
    partition: i32,
    offset: i64,
) -> EventOutcome {
    let description = describe_chat_event(&event.event().event);
    if description.action == ChatIndexAction::Ignore {
        tracing::trace!(
            chat_id = description.chat_id,
            event_type = description.event_type,
            partition,
            offset,
            "ignoring chat event without a search-index action"
        );
        return EventOutcome::Ignored;
    }

    let result = retry_processing(|attempt| async move {
        tracing::trace!(
            chat_id = description.chat_id,
            event_type = description.event_type,
            partition,
            offset,
            attempt,
            "processing chat search-index event"
        );
        process_chat_index_action(db, opensearch_client, description.action)
            .await
            .inspect_err(|error| {
                if attempt < MAX_PROCESSING_ATTEMPTS {
                    let retry_delay =
                        PROCESSING_RETRY_BASE_DELAY * 2u32.pow(attempt.saturating_sub(1));
                    tracing::warn!(
                        error = ?error,
                        chat_id = description.chat_id,
                        event_type = description.event_type,
                        partition,
                        offset,
                        attempt,
                        delay_secs = retry_delay.as_secs(),
                        "chat search-index processing failed, retrying"
                    );
                }
            })
    })
    .await;

    match result {
        Ok(()) => EventOutcome::Indexed,
        Err(error) => {
            tracing::error!(
                error = ?error,
                chat_id = description.chat_id,
                event_type = description.event_type,
                partition,
                offset,
                attempts = MAX_PROCESSING_ATTEMPTS,
                "dropping chat event after processing retries were exhausted"
            );
            EventOutcome::Dropped
        }
    }
}
