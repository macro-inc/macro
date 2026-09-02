//! Outbound trait contracts for the backfill domain.
//!
//! Three ports:
//!
//! - [`BackfillSource`] — entity-aware reader. One method per searchable
//!   entity, producing either a queue-backed [`SourcePage`] or a typed
//!   [`PropertySourcePage`] for a given pagination position.
//! - [`SearchEventPublisher`] — entity-agnostic batch publisher onto the
//!   search-event queue.
//! - [`PropertyBackfillIndexer`] — directly reindexes one typed entity's
//!   denormalized properties.
//!
//! Splitting reads (source) from the queue write (publisher) keeps each
//! adapter single-concern and lets the application-level pagination loop be
//! tested with in-memory fakes.

use std::future::Future;

use models_properties::EntityType;
use sqs_client::search::SearchQueueMessage;

use super::models::{
    BackfillError, CalendarEventBackfillCursor, CalendarEventBackfillRequest, CallBackfillCursor,
    CallBackfillRequest, ChannelBackfillRequest, ChatBackfillCursor, ChatBackfillRequest,
    DocumentBackfillCursor, DocumentBackfillRequest, EmailBackfillRequest, ProjectBackfillCursor,
    ProjectBackfillRequest, PropertiesBackfillRequest, PropertySourcePage, SourcePage,
};

/// Publishes batches of search-event messages.
pub trait SearchEventPublisher: Send + Sync + 'static {
    fn publish(
        &self,
        messages: Vec<SearchQueueMessage>,
    ) -> impl Future<Output = Result<(), BackfillError>> + Send;
}

/// Directly reindexes denormalized properties for one typed entity.
pub trait PropertyBackfillIndexer: Send + Sync + 'static {
    /// Refetch and overwrite the indexed properties for an entity.
    fn reindex(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<(), BackfillError>> + Send;
}

/// Source of backfill work across every searchable entity. The orchestrator
/// calls one of these methods per request.
///
/// `rows_consumed` on each [`SourcePage`] is the unit the orchestrator
/// advances by; `messages` is what gets handed to the publisher. Sources
/// that fold many rows into fewer messages (e.g. emails batching threads
/// per user) must report the row count separately so the loop offsets
/// correctly.
pub trait BackfillSource: Send + Sync + 'static {
    /// Calls paginate by keyset cursor (mirroring documents/chats): the
    /// implementation returns the page plus the cursor of the last row
    /// to feed back into the next call. An empty page signals
    /// end-of-source. When `req.call_ids` is non-empty, the
    /// implementation paginates the explicit list with the cursor
    /// instead of scanning the table.
    fn fetch_calls(
        &self,
        req: &CallBackfillRequest,
        cursor: Option<CallBackfillCursor>,
    ) -> impl Future<Output = Result<(SourcePage, Option<CallBackfillCursor>), BackfillError>> + Send;

    /// Chats paginate by keyset cursor (mirroring documents): each call
    /// passes the cursor of the last row from the previous page (or
    /// `None` for the first page), and the implementation returns the
    /// page plus the cursor to feed back into the next call. An empty
    /// page signals end-of-source.
    fn fetch_chats(
        &self,
        req: &ChatBackfillRequest,
        cursor: Option<ChatBackfillCursor>,
    ) -> impl Future<Output = Result<(SourcePage, Option<ChatBackfillCursor>), BackfillError>> + Send;

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

    /// Distinct entity ids holding property rows of the requested type,
    /// paginated by plain offset over `entity_properties`.
    fn fetch_entity_properties(
        &self,
        req: &PropertiesBackfillRequest,
        offset: usize,
    ) -> impl Future<Output = Result<PropertySourcePage, BackfillError>> + Send;

    /// Projects paginate by keyset cursor (mirroring documents): each call
    /// passes the cursor of the last row from the previous page (or `None`
    /// for the first page), and the implementation returns the page plus
    /// the cursor to feed back into the next call. An empty page signals
    /// end-of-source.
    fn fetch_projects(
        &self,
        req: &ProjectBackfillRequest,
        cursor: Option<ProjectBackfillCursor>,
    ) -> impl Future<Output = Result<(SourcePage, Option<ProjectBackfillCursor>), BackfillError>> + Send;

    /// Calendar events paginate by keyset cursor (mirroring projects): each
    /// call returns one page plus the cursor to resume from.
    fn fetch_calendar_events(
        &self,
        req: &CalendarEventBackfillRequest,
        cursor: Option<CalendarEventBackfillCursor>,
    ) -> impl Future<
        Output = Result<(SourcePage, Option<CalendarEventBackfillCursor>), BackfillError>,
    > + Send;
}
