//! Maps calendar event changes to search-index reconciliations and processes them.

use calendar_events::domain::events::{CalendarMacroEvent, CalendarTopicEvent};
use macro_event_broker::MacroEvent as _;
use sqs_client::search::calendar_event::UpsertCalendarEvent;

use super::{
    EventOutcome, KafkaProcessingContext, MAX_PROCESSING_ATTEMPTS, PROCESSING_RETRY_BASE_DELAY,
    retry_processing,
};
use crate::process::calendar_event::{remove_calendar_event, upsert_calendar_event};

/// What one topic event asks the index to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CalendarIndexAction {
    /// Re-read the row and write the resulting document.
    Reindex,
    /// Drop the document. The row is already gone, so there is nothing to
    /// read — reindexing would spend a query to learn that.
    Remove,
}

pub(super) fn index_action(event: &CalendarTopicEvent) -> (CalendarIndexAction, &'static str) {
    match event {
        CalendarTopicEvent::Created(_) => (CalendarIndexAction::Reindex, "calendar_event.created"),
        CalendarTopicEvent::Updated(_) => (CalendarIndexAction::Reindex, "calendar_event.updated"),
        CalendarTopicEvent::Deleted(_) => (CalendarIndexAction::Remove, "calendar_event.deleted"),
    }
}

/// Reconcile one event's search document.
pub(super) async fn process_calendar_event(
    context: &KafkaProcessingContext,
    event: &CalendarMacroEvent,
    partition: i32,
    offset: i64,
) -> EventOutcome {
    let opensearch_client = context.opensearch_client.as_ref();
    // The producer keys every calendar event by its entity id.
    let event_id = event.key().to_string();
    let (action, event_type) = index_action(&event.event().event);
    let result = retry_processing(|attempt| {
        let event_id = event_id.clone();
        async move {
            tracing::trace!(
                event_id = event_id,
                event_type,
                partition,
                offset,
                attempt,
                "processing calendar search-index event"
            );
            match action {
                CalendarIndexAction::Reindex => {
                    upsert_calendar_event(
                        opensearch_client,
                        &context.db,
                        &UpsertCalendarEvent {
                            event_id: event_id.clone(),
                            index_override: None,
                        },
                    )
                    .await
                }
                CalendarIndexAction::Remove => {
                    remove_calendar_event(opensearch_client, &event_id, None).await
                }
            }
            .inspect_err(|error| {
                if attempt < MAX_PROCESSING_ATTEMPTS {
                    let retry_delay =
                        PROCESSING_RETRY_BASE_DELAY * 2u32.pow(attempt.saturating_sub(1));
                    tracing::warn!(
                        error = ?error,
                        event_id = event_id,
                        event_type,
                        partition,
                        offset,
                        attempt,
                        delay_secs = retry_delay.as_secs(),
                        "calendar search-index processing failed, retrying"
                    );
                }
            })
        }
    })
    .await;

    match result {
        Ok(()) => EventOutcome::Indexed,
        Err(error) => {
            tracing::error!(
                error = ?error,
                event_id = event_id,
                event_type,
                partition,
                offset,
                attempts = MAX_PROCESSING_ATTEMPTS,
                "dropping calendar event after processing retries were exhausted"
            );
            EventOutcome::Dropped
        }
    }
}
