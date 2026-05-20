//! Outbound trait contracts for the backfill domain.
//!
//! Two ports:
//!
//! - [`BackfillSource`] — entity-aware reader. One method per searchable
//!   entity, each producing a [`SourcePage`] (messages + rows consumed) for
//!   a given offset. The orchestrator drives sources through these methods.
//! - [`SearchEventPublisher`] — entity-agnostic batch publisher onto the
//!   search-event queue.
//!
//! Splitting reads (source) from the queue write (publisher) keeps each
//! adapter single-concern and lets the application-level pagination loop be
//! tested with in-memory fakes.

use std::future::Future;

use sqs_client::search::SearchQueueMessage;

use super::models::{
    BackfillError, CallBackfillRequest, ChannelBackfillRequest, ChatBackfillRequest,
    DocumentBackfillCursor, DocumentBackfillRequest, EmailBackfillRequest, SourcePage,
};

/// Publishes batches of search-event messages.
pub trait SearchEventPublisher: Send + Sync + 'static {
    fn publish(
        &self,
        messages: Vec<SearchQueueMessage>,
    ) -> impl Future<Output = Result<(), BackfillError>> + Send;
}

/// Source of backfill messages across every searchable entity. The
/// orchestrator's `drain_source` loop calls one of these per request.
///
/// `rows_consumed` on each [`SourcePage`] is the unit the orchestrator
/// advances by; `messages` is what gets handed to the publisher. Sources
/// that fold many rows into fewer messages (e.g. emails batching threads
/// per user) must report the row count separately so the loop offsets
/// correctly.
pub trait BackfillSource: Send + Sync + 'static {
    fn fetch_calls(
        &self,
        req: &CallBackfillRequest,
        offset: usize,
    ) -> impl Future<Output = Result<SourcePage, BackfillError>> + Send;

    fn fetch_chats(
        &self,
        req: &ChatBackfillRequest,
        offset: usize,
    ) -> impl Future<Output = Result<SourcePage, BackfillError>> + Send;

    fn fetch_channels(
        &self,
        req: &ChannelBackfillRequest,
        offset: usize,
    ) -> impl Future<Output = Result<SourcePage, BackfillError>> + Send;

    /// Documents paginate by keyset cursor: each call passes the cursor
    /// of the last row from the previous page (or `None` for the first
    /// page), and the implementation returns the page plus the cursor
    /// to feed back into the next call. An empty page signals
    /// end-of-source.
    fn fetch_documents(
        &self,
        req: &DocumentBackfillRequest,
        cursor: Option<DocumentBackfillCursor>,
    ) -> impl Future<Output = Result<(SourcePage, Option<DocumentBackfillCursor>), BackfillError>> + Send;

    fn fetch_emails(
        &self,
        req: &EmailBackfillRequest,
        offset: usize,
    ) -> impl Future<Output = Result<SourcePage, BackfillError>> + Send;
}
