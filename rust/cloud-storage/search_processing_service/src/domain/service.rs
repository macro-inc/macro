//! Application-level backfill service.
//!
//! [`BackfillService`] is the inbound contract the HTTP layer talks to. The
//! [`BackfillOrchestrator`] holds one [`BackfillSource`] (which knows about
//! every entity type) and one [`SearchEventPublisher`], and runs the shared
//! paginate-and-publish loop that drains a source onto the publisher. The
//! loop lives here (in the domain) so it can be tested with in-memory fakes
//! — adapters stay single-concern.

use std::future::Future;
use std::sync::Arc;

use tokio_util::sync::CancellationToken;

use super::jobs::JobProgress;
use super::models::{
    BackfillError, BackfillReceipt, CallBackfillRequest, ChannelBackfillRequest,
    ChatBackfillRequest, DocumentBackfillRequest, EmailBackfillRequest, SourcePage,
};
use super::ports::{BackfillSource, SearchEventPublisher};

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
}

pub struct BackfillOrchestrator<S, P> {
    source: S,
    publisher: P,
}

impl<S, P> BackfillOrchestrator<S, P>
where
    S: BackfillSource,
    P: SearchEventPublisher,
{
    pub fn new(source: S, publisher: P) -> Self {
        Self { source, publisher }
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
        progress.add(page.rows_consumed);
    }

    Ok(BackfillReceipt { enqueued })
}

impl<S, P> BackfillService for BackfillOrchestrator<S, P>
where
    S: BackfillSource,
    P: SearchEventPublisher,
{
    async fn backfill_calls(
        &self,
        req: CallBackfillRequest,
        progress: Arc<JobProgress>,
        cancel: CancellationToken,
    ) -> Result<BackfillReceipt, BackfillError> {
        drain_source(&self.publisher, &progress, &cancel, |offset| {
            self.source.fetch_calls(&req, offset)
        })
        .await
    }

    async fn backfill_chats(
        &self,
        req: ChatBackfillRequest,
        progress: Arc<JobProgress>,
        cancel: CancellationToken,
    ) -> Result<BackfillReceipt, BackfillError> {
        drain_source(&self.publisher, &progress, &cancel, |offset| {
            self.source.fetch_chats(&req, offset)
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
        drain_source(&self.publisher, &progress, &cancel, |offset| {
            self.source.fetch_documents(&req, offset)
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
}

#[cfg(test)]
mod test;
