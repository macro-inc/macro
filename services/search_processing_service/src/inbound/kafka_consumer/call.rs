//! Maps call lifecycle events to search-index actions and processes them.

use ::call::domain::events::{CallMacroEvent, CallTopicEvent};
use macro_event_broker::MacroEvent as _;
use opensearch_client::OpensearchClient;
use sqlx::PgPool;
use uuid::Uuid;

use super::{EventOutcome, MAX_PROCESSING_ATTEMPTS, PROCESSING_RETRY_BASE_DELAY, retry_processing};
use crate::process::call::{process_call_record, process_remove_call_record};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CallIndexAction {
    Upsert { call_id: Uuid },
    Remove { call_id: Uuid, channel_id: Uuid },
    Ignore,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct CallEventDescription {
    pub(super) action: CallIndexAction,
    pub(super) call_id: Uuid,
    pub(super) event_type: &'static str,
}

pub(super) fn describe_call_event(event: &CallTopicEvent) -> CallEventDescription {
    match event {
        CallTopicEvent::Started(metadata) => CallEventDescription {
            action: CallIndexAction::Ignore,
            call_id: metadata.call_id,
            event_type: "call.started",
        },
        CallTopicEvent::RecordArchived(metadata) => CallEventDescription {
            action: CallIndexAction::Upsert {
                call_id: metadata.call_id,
            },
            call_id: metadata.call_id,
            event_type: "call.record_archived",
        },
        CallTopicEvent::RecordUpdated(metadata) => CallEventDescription {
            action: CallIndexAction::Upsert {
                call_id: metadata.call_id,
            },
            call_id: metadata.call_id,
            event_type: "call.record_updated",
        },
        CallTopicEvent::RecordDeleted(metadata) => CallEventDescription {
            action: CallIndexAction::Remove {
                call_id: metadata.call_id,
                channel_id: metadata.channel_id,
            },
            call_id: metadata.call_id,
            event_type: "call.record_deleted",
        },
        CallTopicEvent::RecordSummarized(metadata) => CallEventDescription {
            action: CallIndexAction::Upsert {
                call_id: metadata.call_id,
            },
            call_id: metadata.call_id,
            event_type: "call.record_summarized",
        },
        CallTopicEvent::RecordingReady(metadata) => CallEventDescription {
            action: CallIndexAction::Ignore,
            call_id: metadata.call_id,
            event_type: "call.recording_ready",
        },
    }
}

async fn process_call_index_action(
    db: &PgPool,
    opensearch_client: &OpensearchClient,
    action: CallIndexAction,
) -> anyhow::Result<()> {
    match action {
        CallIndexAction::Upsert { call_id } => {
            process_call_record(opensearch_client, db, call_id, None).await
        }
        CallIndexAction::Remove {
            call_id,
            channel_id,
        } => process_remove_call_record(opensearch_client, channel_id, Some(call_id), None).await,
        CallIndexAction::Ignore => Ok(()),
    }
}

pub(super) async fn process_call_event(
    db: &PgPool,
    opensearch_client: &OpensearchClient,
    event: &CallMacroEvent,
    partition: i32,
    offset: i64,
) -> EventOutcome {
    let description = describe_call_event(&event.event().event);
    if description.action == CallIndexAction::Ignore {
        tracing::trace!(
            call_id = %description.call_id,
            event_type = description.event_type,
            partition,
            offset,
            "ignoring call event without a search-index action"
        );
        return EventOutcome::Ignored;
    }

    let result = retry_processing(|attempt| async move {
        tracing::trace!(
            call_id = %description.call_id,
            event_type = description.event_type,
            partition,
            offset,
            attempt,
            "processing call search-index event"
        );
        process_call_index_action(db, opensearch_client, description.action)
            .await
            .inspect_err(|error| {
                if attempt < MAX_PROCESSING_ATTEMPTS {
                    let retry_delay =
                        PROCESSING_RETRY_BASE_DELAY * 2u32.pow(attempt.saturating_sub(1));
                    tracing::warn!(
                        error = ?error,
                        call_id = %description.call_id,
                        event_type = description.event_type,
                        partition,
                        offset,
                        attempt,
                        delay_secs = retry_delay.as_secs(),
                        "call search-index processing failed, retrying"
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
                call_id = %description.call_id,
                event_type = description.event_type,
                partition,
                offset,
                attempts = MAX_PROCESSING_ATTEMPTS,
                "dropping call event after processing retries were exhausted"
            );
            EventOutcome::Dropped
        }
    }
}
