//! Maps calendar event changes to search-index reconciliations and processes them.

use calendar_events::domain::events::CalendarMacroEvent;
use macro_event_broker::MacroEvent as _;
use opensearch_client::OpensearchClient;
use sqlx::PgPool;
use sqs_client::search::calendar_event::UpsertCalendarEvent;

use super::{EventOutcome, MAX_PROCESSING_ATTEMPTS, PROCESSING_RETRY_BASE_DELAY, retry_processing};
use crate::process::calendar_event::upsert_calendar_event;

/// Reconcile one event's search document.
///
/// The topic carries a single `Changed` variant: it reports that an event's
/// canonical state moved without saying how, because no calendar write path
/// can tell created from updated from removed. So there is nothing to
/// describe or branch on — reconciliation always re-reads the row, and
/// `upsert_calendar_event` turns a row that is gone into a delete.
pub(super) async fn process_calendar_event(
    db: &PgPool,
    opensearch_client: &OpensearchClient,
    event: &CalendarMacroEvent,
    partition: i32,
    offset: i64,
) -> EventOutcome {
    // The producer keys every calendar event by its entity id.
    let event_id = event.key().to_string();
    let result = retry_processing(|attempt| {
        let event_id = event_id.clone();
        async move {
            tracing::trace!(
                event_id = event_id,
                partition,
                offset,
                attempt,
                "processing calendar search-index event"
            );
            upsert_calendar_event(
                opensearch_client,
                db,
                &UpsertCalendarEvent {
                    event_id: event_id.clone(),
                    index_override: None,
                },
            )
            .await
            .inspect_err(|error| {
                if attempt < MAX_PROCESSING_ATTEMPTS {
                    let retry_delay =
                        PROCESSING_RETRY_BASE_DELAY * 2u32.pow(attempt.saturating_sub(1));
                    tracing::warn!(
                        error = ?error,
                        event_id = event_id,
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
                partition,
                offset,
                attempts = MAX_PROCESSING_ATTEMPTS,
                "dropping calendar event after processing retries were exhausted"
            );
            EventOutcome::Dropped
        }
    }
}
