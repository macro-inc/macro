//! Application-level backfill service.
//!
//! [`BackfillService`] is the inbound contract the HTTP layer talks to. The
//! [`BackfillOrchestrator`] holds one source adapter per entity plus a single
//! [`SearchEventPublisher`], and runs the shared paginate-and-publish loop
//! that drains a source onto the publisher. The loop lives here (in the
//! domain) so it can be tested with in-memory fakes — adapters stay
//! single-concern.

use std::future::Future;

use super::models::{
    BackfillError, BackfillReceipt, CallBackfillRequest, ChannelBackfillRequest,
    ChatBackfillRequest, DocumentBackfillRequest, EmailBackfillRequest, SourcePage,
};
use super::ports::{
    CallBackfillSource, ChannelBackfillSource, ChatBackfillSource, DocumentBackfillSource,
    EmailBackfillSource, SearchEventPublisher,
};

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
/// page's messages, and stopping when the source reports zero rows consumed.
/// Offset advances by `rows_consumed`, *not* by message count — sources are
/// free to fold many rows into a smaller batch of messages (see
/// [`crate::outbound::backfill::emails::PgEmailSource`]) without confusing
/// the loop into re-reading rows.
async fn drain_source<Fut, P>(
    publisher: &P,
    fetch: impl Fn(usize) -> Fut,
) -> Result<BackfillReceipt, BackfillError>
where
    Fut: Future<Output = Result<SourcePage, BackfillError>>,
    P: SearchEventPublisher,
{
    let mut offset = 0usize;
    let mut enqueued = 0usize;

    loop {
        let page = fetch(offset).await?;
        if page.rows_consumed == 0 {
            break;
        }
        publisher.publish(page.messages).await?;
        enqueued += page.rows_consumed;
        offset += page.rows_consumed;
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
