//! Search-queue implementation of the calendar search indexer port.
//!
//! Calendar has no Kafka topic, so this is the live indexing path rather than
//! a backfill-only one: the queue message names an event, and the search
//! processing service re-reads the row to decide between an upsert and a
//! delete.

use std::sync::Arc;

use rootcause::Report;
use sqs_client::search::{
    SearchQueueMessage,
    calendar_event::{RemoveCalendarEvent, UpsertCalendarEvent},
};
use uuid::Uuid;

use crate::domain::ports::CalendarSearchIndexer;

/// Calendar search indexer backed by the shared search-event queue.
#[derive(Clone)]
pub struct SqsCalendarSearchIndexer {
    sqs: Arc<sqs_client::SQS>,
}

impl SqsCalendarSearchIndexer {
    /// Point an adapter at the configured search-event queue.
    pub fn new(sqs: Arc<sqs_client::SQS>) -> Self {
        Self { sqs }
    }
}

impl CalendarSearchIndexer for SqsCalendarSearchIndexer {
    #[tracing::instrument(skip(self), err)]
    async fn index_event(&self, event_id: Uuid) -> Result<(), Report> {
        self.sqs
            .send_message_to_search_event_queue(SearchQueueMessage::UpsertCalendarEvent(
                UpsertCalendarEvent {
                    event_id: event_id.to_string(),
                    index_override: None,
                },
            ))
            .await
            .map(|_| ())
            .map_err(|error| rootcause::report!("{error:?}"))
    }

    #[tracing::instrument(skip(self), err)]
    async fn remove_event(&self, event_id: Uuid) -> Result<(), Report> {
        self.sqs
            .send_message_to_search_event_queue(SearchQueueMessage::RemoveCalendarEvent(
                RemoveCalendarEvent {
                    event_id: event_id.to_string(),
                    index_override: None,
                },
            ))
            .await
            .map(|_| ())
            .map_err(|error| rootcause::report!("{error:?}"))
    }
}
