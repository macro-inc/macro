//! Application-level backfill service.
//!
//! [`BackfillService`] is the inbound contract the HTTP layer talks to. The
//! [`BackfillOrchestrator`] holds one source adapter per entity plus a single
//! [`SearchEventPublisher`], and runs the shared paginate-and-publish loop
//! that drains a source onto the publisher. The loop lives here (in the
//! domain) so it can be tested with in-memory fakes — adapters stay
//! single-concern.

use std::future::Future;

use sqs_client::search::SearchQueueMessage;

use crate::outbound::backfill::{
    calls::PgCallSource, channels::PgChannelSource, chats::PgChatSource,
    documents::PgDocumentSource, emails::PgEmailSource,
};
use crate::outbound::publisher::SqsSearchEventPublisher;

use super::models::{
    BackfillError, BackfillReceipt, CallBackfillRequest, ChannelBackfillRequest,
    ChatBackfillRequest, DocumentBackfillRequest, EmailBackfillRequest,
};
use super::ports::{
    CallBackfillSource, ChannelBackfillSource, ChatBackfillSource, DocumentBackfillSource,
    EmailBackfillSource, SearchEventPublisher,
};

/// Concrete [`BackfillService`] wired to the production Postgres sources and
/// the SQS publisher.
pub type BackfillServiceImpl = BackfillOrchestrator<
    PgCallSource,
    PgChatSource,
    PgChannelSource,
    PgDocumentSource,
    PgEmailSource,
    SqsSearchEventPublisher,
>;

/// Inbound contract for all backfill HTTP routes.
pub trait BackfillService: Send + Sync + 'static {
    fn backfill_calls(
        &self,
        req: CallBackfillRequest,
    ) -> impl Future<Output = Result<BackfillReceipt, BackfillError>> + Send;
    fn backfill_chats(
        &self,
        req: ChatBackfillRequest,
    ) -> impl Future<Output = Result<BackfillReceipt, BackfillError>> + Send;
    fn backfill_channels(
        &self,
        req: ChannelBackfillRequest,
    ) -> impl Future<Output = Result<BackfillReceipt, BackfillError>> + Send;
    fn backfill_documents(
        &self,
        req: DocumentBackfillRequest,
    ) -> impl Future<Output = Result<BackfillReceipt, BackfillError>> + Send;
    fn backfill_emails(
        &self,
        req: EmailBackfillRequest,
    ) -> impl Future<Output = Result<BackfillReceipt, BackfillError>> + Send;
}

pub struct BackfillOrchestrator<Call, Chat, Channel, Doc, Email, Pub> {
    calls: Call,
    chats: Chat,
    channels: Channel,
    documents: Doc,
    emails: Email,
    publisher: Pub,
}

impl<Call, Chat, Channel, Doc, Email, Pub>
    BackfillOrchestrator<Call, Chat, Channel, Doc, Email, Pub>
where
    Call: CallBackfillSource,
    Chat: ChatBackfillSource,
    Channel: ChannelBackfillSource,
    Doc: DocumentBackfillSource,
    Email: EmailBackfillSource,
    Pub: SearchEventPublisher,
{
    pub fn new(
        calls: Call,
        chats: Chat,
        channels: Channel,
        documents: Doc,
        emails: Email,
        publisher: Pub,
    ) -> Self {
        Self {
            calls,
            chats,
            channels,
            documents,
            emails,
            publisher,
        }
    }
}

/// Drive a source by repeatedly calling `fetch_page(offset)`, publishing each
/// non-empty page, and stopping when the source returns an empty page. The
/// offset advances by the page length the source actually returned, so a
/// short last page doesn't cause an extra fetch — but a source that returns
/// `page_size` items on the final boundary will see one extra empty fetch
/// before termination, which is intentional and cheap.
async fn drain_source<Fut, P>(
    publisher: &P,
    fetch: impl Fn(usize) -> Fut,
) -> Result<BackfillReceipt, BackfillError>
where
    Fut: Future<Output = Result<Vec<SearchQueueMessage>, BackfillError>>,
    P: SearchEventPublisher + ?Sized,
{
    let mut offset = 0usize;
    let mut enqueued = 0usize;

    loop {
        let page = fetch(offset).await?;
        if page.is_empty() {
            break;
        }
        let n = page.len();
        publisher.publish(page).await?;
        enqueued += n;
        offset += n;
    }

    Ok(BackfillReceipt { enqueued })
}

impl<Call, Chat, Channel, Doc, Email, Pub> BackfillService
    for BackfillOrchestrator<Call, Chat, Channel, Doc, Email, Pub>
where
    Call: CallBackfillSource,
    Chat: ChatBackfillSource,
    Channel: ChannelBackfillSource,
    Doc: DocumentBackfillSource,
    Email: EmailBackfillSource,
    Pub: SearchEventPublisher,
{
    async fn backfill_calls(
        &self,
        req: CallBackfillRequest,
    ) -> Result<BackfillReceipt, BackfillError> {
        drain_source(&self.publisher, |offset| {
            self.calls.fetch_page(&req, offset)
        })
        .await
    }

    async fn backfill_chats(
        &self,
        req: ChatBackfillRequest,
    ) -> Result<BackfillReceipt, BackfillError> {
        drain_source(&self.publisher, |offset| {
            self.chats.fetch_page(&req, offset)
        })
        .await
    }

    async fn backfill_channels(
        &self,
        req: ChannelBackfillRequest,
    ) -> Result<BackfillReceipt, BackfillError> {
        drain_source(&self.publisher, |offset| {
            self.channels.fetch_page(&req, offset)
        })
        .await
    }

    async fn backfill_documents(
        &self,
        req: DocumentBackfillRequest,
    ) -> Result<BackfillReceipt, BackfillError> {
        drain_source(&self.publisher, |offset| {
            self.documents.fetch_page(&req, offset)
        })
        .await
    }

    async fn backfill_emails(
        &self,
        req: EmailBackfillRequest,
    ) -> Result<BackfillReceipt, BackfillError> {
        drain_source(&self.publisher, |offset| {
            self.emails.fetch_page(&req, offset)
        })
        .await
    }
}

#[cfg(test)]
mod test;
