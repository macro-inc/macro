//! Outbound trait contracts for the backfill domain.
//!
//! Two kinds of ports:
//!
//! - **Sources** — one per entity type. Each knows how to read its source of
//!   truth and shape the result into [`SearchQueueMessage`]s. The application
//!   service drives sources through `fetch_page(req, offset)`; an empty page
//!   signals the loop to stop.
//! - **Publisher** — one trait, one job: deliver a batch of
//!   [`SearchQueueMessage`]s onto the search-event queue.
//!
//! Splitting per-entity DB reads (sources) from the queue write (publisher)
//! keeps each adapter single-concern and lets the application-level
//! pagination loop be tested with in-memory fakes.

use std::future::Future;

use sqs_client::search::SearchQueueMessage;

use super::models::{
    BackfillError, CallBackfillRequest, ChannelBackfillRequest, ChatBackfillRequest,
    DocumentBackfillRequest, EmailBackfillRequest,
};

/// Publishes batches of search-event messages. Entity-agnostic.
pub trait SearchEventPublisher: Send + Sync + 'static {
    fn publish(
        &self,
        messages: Vec<SearchQueueMessage>,
    ) -> impl Future<Output = Result<(), BackfillError>> + Send;
}

/// Source for archived call records.
pub trait CallBackfillSource: Send + Sync + 'static {
    fn fetch_page(
        &self,
        req: &CallBackfillRequest,
        offset: usize,
    ) -> impl Future<Output = Result<Vec<SearchQueueMessage>, BackfillError>> + Send;
}

/// Source for chat messages.
pub trait ChatBackfillSource: Send + Sync + 'static {
    fn fetch_page(
        &self,
        req: &ChatBackfillRequest,
        offset: usize,
    ) -> impl Future<Output = Result<Vec<SearchQueueMessage>, BackfillError>> + Send;
}

/// Source for channel messages.
pub trait ChannelBackfillSource: Send + Sync + 'static {
    fn fetch_page(
        &self,
        req: &ChannelBackfillRequest,
        offset: usize,
    ) -> impl Future<Output = Result<Vec<SearchQueueMessage>, BackfillError>> + Send;
}

/// Source for documents.
pub trait DocumentBackfillSource: Send + Sync + 'static {
    fn fetch_page(
        &self,
        req: &DocumentBackfillRequest,
        offset: usize,
    ) -> impl Future<Output = Result<Vec<SearchQueueMessage>, BackfillError>> + Send;
}

/// Source for email threads.
pub trait EmailBackfillSource: Send + Sync + 'static {
    fn fetch_page(
        &self,
        req: &EmailBackfillRequest,
        offset: usize,
    ) -> impl Future<Output = Result<Vec<SearchQueueMessage>, BackfillError>> + Send;
}
