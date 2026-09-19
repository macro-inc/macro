//! Application-level backfill service.
//!
//! [`BackfillService`] is the inbound contract the HTTP layer talks to. The
//! [`BackfillOrchestrator`] holds a [`BackfillSource`], a
//! [`SearchEventPublisher`] for queue-backed families, and a
//! [`PropertyBackfillIndexer`] for direct property indexing. The orchestration
//! loops live here so they can be tested with in-memory fakes while adapters
//! stay single-concern.

use std::future::Future;
use std::sync::Arc;

use futures::{StreamExt, TryStreamExt, stream};
use tokio_util::sync::CancellationToken;

use super::jobs::JobProgress;
use super::models::{
    BackfillError, BackfillReceipt, CalendarEventBackfillRequest, CallBackfillRequest,
    ChannelBackfillRequest, ChatBackfillRequest, DocumentBackfillRequest, EmailBackfillRequest,
    ProjectBackfillRequest, PropertiesBackfillRequest, PropertySourcePage, SourcePage,
};
use super::ports::{BackfillSource, PropertyBackfillIndexer, SearchEventPublisher};

/// Drive a source by repeatedly calling `fetch(cursor)`, publishing each
/// page's messages, and stopping when the source reports zero rows
/// consumed. Identical loop shape to [`drain_source`] but the state
/// advanced between pages is an opaque cursor returned by the fetcher
/// rather than an integer offset — used by entities (documents) that
/// paginate by sort-key.
async fn drain_source_with_cursor<C, Fut, P>(
    publisher: &P,
    progress: &JobProgress,
    cancel: &CancellationToken,
    fetch: impl Fn(Option<C>) -> Fut,
) -> Result<BackfillReceipt, BackfillError>
where
    Fut: Future<Output = Result<(SourcePage, Option<C>), BackfillError>>,
    P: SearchEventPublisher,
{
    let mut cursor: Option<C> = None;
    let mut enqueued = 0usize;

    loop {
        if cancel.is_cancelled() {
            tracing::info!(enqueued, "backfill cancelled between pages");
            break;
        }
        let (page, next_cursor) = fetch(cursor).await?;
        if page.rows_consumed == 0 {
            break;
        }
        publisher.publish(page.messages).await?;
        enqueued += page.rows_consumed;
        progress.add(page.rows_consumed).await;
        // Source signals end-of-stream by returning `None` for the next
        // cursor on a non-empty page (e.g. last row's sort-key column was
        // unexpectedly NULL). Treat that as termination; otherwise we'd
        // pass `None` to the next `fetch` and restart pagination from the
        // beginning.
        let Some(next) = next_cursor else { break };
        cursor = Some(next);
    }

    Ok(BackfillReceipt { enqueued })
}

/// Inbound contract for all backfill HTTP routes. Each call drives a single
/// orchestration to completion (or to cancellation via `cancel`); the HTTP
/// layer is responsible for spawning these onto a background task and
/// reporting progress through `progress`.
pub trait BackfillService: Send + Sync + 'static {
    fn backfill_calls(
        &self,
        req: CallBackfillRequest,
        progress: Arc<JobProgress>,
        cancel: CancellationToken,
    ) -> impl Future<Output = Result<BackfillReceipt, BackfillError>> + Send;
    fn backfill_chats(
        &self,
        req: ChatBackfillRequest,
        progress: Arc<JobProgress>,
        cancel: CancellationToken,
    ) -> impl Future<Output = Result<BackfillReceipt, BackfillError>> + Send;
    fn backfill_channels(
        &self,
        req: ChannelBackfillRequest,
        progress: Arc<JobProgress>,
        cancel: CancellationToken,
    ) -> impl Future<Output = Result<BackfillReceipt, BackfillError>> + Send;
    fn backfill_documents(
        &self,
        req: DocumentBackfillRequest,
        progress: Arc<JobProgress>,
        cancel: CancellationToken,
    ) -> impl Future<Output = Result<BackfillReceipt, BackfillError>> + Send;
    fn backfill_emails(
        &self,
        req: EmailBackfillRequest,
        progress: Arc<JobProgress>,
        cancel: CancellationToken,
    ) -> impl Future<Output = Result<BackfillReceipt, BackfillError>> + Send;
    fn backfill_entity_properties(
        &self,
        req: PropertiesBackfillRequest,
        progress: Arc<JobProgress>,
        cancel: CancellationToken,
    ) -> impl Future<Output = Result<BackfillReceipt, BackfillError>> + Send;
    fn backfill_projects(
        &self,
        req: ProjectBackfillRequest,
        progress: Arc<JobProgress>,
        cancel: CancellationToken,
    ) -> impl Future<Output = Result<BackfillReceipt, BackfillError>> + Send;
    fn backfill_calendar_events(
        &self,
        req: CalendarEventBackfillRequest,
        progress: Arc<JobProgress>,
        cancel: CancellationToken,
    ) -> impl Future<Output = Result<BackfillReceipt, BackfillError>> + Send;
}

pub struct BackfillOrchestrator<S, P, I> {
    source: S,
    publisher: P,
    property_indexer: I,
}

impl<S, P, I> BackfillOrchestrator<S, P, I>
where
    S: BackfillSource,
    P: SearchEventPublisher,
    I: PropertyBackfillIndexer,
{
    pub fn new(source: S, publisher: P, property_indexer: I) -> Self {
        Self {
            source,
            publisher,
            property_indexer,
        }
    }
}

/// Drive a source by repeatedly calling `fetch(offset)`, publishing each
/// page's messages, and stopping when the source reports zero rows consumed.
/// Offset advances by `rows_consumed`, *not* by message count — sources are
/// free to fold many rows into a smaller batch of messages (see the email
/// path) without confusing the loop into re-reading rows.
///
/// Checks `cancel` at the top of each iteration so a shutdown signal stops
/// the drain between pages instead of mid-publish; the receipt that comes
/// back reflects the rows actually enqueued before cancellation.
async fn drain_source<Fut, P>(
    publisher: &P,
    progress: &JobProgress,
    cancel: &CancellationToken,
    fetch: impl Fn(usize) -> Fut,
) -> Result<BackfillReceipt, BackfillError>
where
    Fut: Future<Output = Result<SourcePage, BackfillError>>,
    P: SearchEventPublisher,
{
    let mut offset = 0usize;
    let mut enqueued = 0usize;

    loop {
        if cancel.is_cancelled() {
            tracing::info!(enqueued, "backfill cancelled between pages");
            break;
        }
        let page = fetch(offset).await?;
        if page.rows_consumed == 0 {
            break;
        }
        publisher.publish(page.messages).await?;
        enqueued += page.rows_consumed;
        offset += page.rows_consumed;
        progress.add(page.rows_consumed).await;
    }

    Ok(BackfillReceipt { enqueued })
}

/// Drain typed property pages with a bounded number of direct reindexes.
/// Cancellation is observed only at page boundaries so each started page is
/// either completed and counted or fails without updating progress.
async fn drain_property_source<Fut, I>(
    indexer: &I,
    progress: &JobProgress,
    cancel: &CancellationToken,
    fetch: impl Fn(usize) -> Fut,
) -> Result<BackfillReceipt, BackfillError>
where
    Fut: Future<Output = Result<PropertySourcePage, BackfillError>>,
    I: PropertyBackfillIndexer,
{
    let mut offset = 0usize;
    let mut enqueued = 0usize;

    loop {
        if cancel.is_cancelled() {
            tracing::info!(enqueued, "property backfill cancelled between pages");
            break;
        }

        let page = fetch(offset).await?;
        if page.rows_consumed == 0 {
            break;
        }

        let PropertySourcePage {
            entity_ids,
            entity_type,
            rows_consumed,
        } = page;

        stream::iter(entity_ids)
            .map(|entity_id| async move { indexer.reindex(&entity_id, entity_type).await })
            .buffer_unordered(20)
            .try_collect::<Vec<()>>()
            .await?;

        enqueued += rows_consumed;
        offset += rows_consumed;
        progress.add(rows_consumed).await;
    }

    Ok(BackfillReceipt { enqueued })
}

impl<S, P, I> BackfillService for BackfillOrchestrator<S, P, I>
where
    S: BackfillSource,
    P: SearchEventPublisher,
    I: PropertyBackfillIndexer,
{
    async fn backfill_calls(
        &self,
        req: CallBackfillRequest,
        progress: Arc<JobProgress>,
        cancel: CancellationToken,
    ) -> Result<BackfillReceipt, BackfillError> {
        drain_source_with_cursor(&self.publisher, &progress, &cancel, |cursor| {
            self.source.fetch_calls(&req, cursor)
        })
        .await
    }

    async fn backfill_chats(
        &self,
        req: ChatBackfillRequest,
        progress: Arc<JobProgress>,
        cancel: CancellationToken,
    ) -> Result<BackfillReceipt, BackfillError> {
        drain_source_with_cursor(&self.publisher, &progress, &cancel, |cursor| {
            self.source.fetch_chats(&req, cursor)
        })
        .await
    }

    async fn backfill_channels(
        &self,
        req: ChannelBackfillRequest,
        progress: Arc<JobProgress>,
        cancel: CancellationToken,
    ) -> Result<BackfillReceipt, BackfillError> {
        drain_source(&self.publisher, &progress, &cancel, |offset| {
            self.source.fetch_channels(&req, offset)
        })
        .await
    }

    async fn backfill_documents(
        &self,
        req: DocumentBackfillRequest,
        progress: Arc<JobProgress>,
        cancel: CancellationToken,
    ) -> Result<BackfillReceipt, BackfillError> {
        drain_source_with_cursor(&self.publisher, &progress, &cancel, |cursor| {
            self.source.fetch_documents(&req, cursor)
        })
        .await
    }

    async fn backfill_emails(
        &self,
        req: EmailBackfillRequest,
        progress: Arc<JobProgress>,
        cancel: CancellationToken,
    ) -> Result<BackfillReceipt, BackfillError> {
        drain_source(&self.publisher, &progress, &cancel, |offset| {
            self.source.fetch_emails(&req, offset)
        })
        .await
    }

    async fn backfill_entity_properties(
        &self,
        req: PropertiesBackfillRequest,
        progress: Arc<JobProgress>,
        cancel: CancellationToken,
    ) -> Result<BackfillReceipt, BackfillError> {
        drain_property_source(&self.property_indexer, &progress, &cancel, |offset| {
            self.source.fetch_entity_properties(&req, offset)
        })
        .await
    }

    async fn backfill_projects(
        &self,
        req: ProjectBackfillRequest,
        progress: Arc<JobProgress>,
        cancel: CancellationToken,
    ) -> Result<BackfillReceipt, BackfillError> {
        drain_source_with_cursor(&self.publisher, &progress, &cancel, |cursor| {
            self.source.fetch_projects(&req, cursor)
        })
        .await
    }

    async fn backfill_calendar_events(
        &self,
        req: CalendarEventBackfillRequest,
        progress: Arc<JobProgress>,
        cancel: CancellationToken,
    ) -> Result<BackfillReceipt, BackfillError> {
        drain_source_with_cursor(&self.publisher, &progress, &cancel, |cursor| {
            self.source.fetch_calendar_events(&req, cursor)
        })
        .await
    }
}

#[cfg(test)]
mod test;
