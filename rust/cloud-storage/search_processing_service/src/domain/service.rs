//! Application-level backfill service.
//!
//! [`BackfillService`] is the single inbound contract the HTTP layer talks to.
//! [`BackfillOrchestrator`] wires one concrete adapter per entity behind that
//! trait, so swapping an adapter (e.g. in-process → HTTP-proxied) is a wiring
//! change rather than a handler rewrite.

use std::future::Future;

use crate::outbound::backfill::{
    calls::PgCallBackfill, channels::PgChannelBackfill, chats::PgChatBackfill,
    documents::PgDocumentBackfill, emails::PgEmailBackfill,
};

use super::models::{
    BackfillError, BackfillReceipt, CallBackfillRequest, ChannelBackfillRequest,
    ChatBackfillRequest, DocumentBackfillRequest, EmailBackfillRequest,
};
use super::ports::{CallBackfill, ChannelBackfill, ChatBackfill, DocumentBackfill, EmailBackfill};

/// Concrete [`BackfillService`] wired to the production Postgres adapters, for
/// use as a type parameter in axum state, etc.
pub type BackfillServiceImpl = BackfillOrchestrator<
    PgCallBackfill,
    PgChatBackfill,
    PgChannelBackfill,
    PgDocumentBackfill,
    PgEmailBackfill,
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

pub struct BackfillOrchestrator<Call, Chat, Channel, Doc, Email> {
    calls: Call,
    chats: Chat,
    channels: Channel,
    documents: Doc,
    emails: Email,
}

impl<Call, Chat, Channel, Doc, Email> BackfillOrchestrator<Call, Chat, Channel, Doc, Email>
where
    Call: CallBackfill,
    Chat: ChatBackfill,
    Channel: ChannelBackfill,
    Doc: DocumentBackfill,
    Email: EmailBackfill,
{
    pub fn new(calls: Call, chats: Chat, channels: Channel, documents: Doc, emails: Email) -> Self {
        Self {
            calls,
            chats,
            channels,
            documents,
            emails,
        }
    }
}

impl<Call, Chat, Channel, Doc, Email> BackfillService
    for BackfillOrchestrator<Call, Chat, Channel, Doc, Email>
where
    Call: CallBackfill,
    Chat: ChatBackfill,
    Channel: ChannelBackfill,
    Doc: DocumentBackfill,
    Email: EmailBackfill,
{
    async fn backfill_calls(
        &self,
        req: CallBackfillRequest,
    ) -> Result<BackfillReceipt, BackfillError> {
        self.calls.enqueue(req).await
    }

    async fn backfill_chats(
        &self,
        req: ChatBackfillRequest,
    ) -> Result<BackfillReceipt, BackfillError> {
        self.chats.enqueue(req).await
    }

    async fn backfill_channels(
        &self,
        req: ChannelBackfillRequest,
    ) -> Result<BackfillReceipt, BackfillError> {
        self.channels.enqueue(req).await
    }

    async fn backfill_documents(
        &self,
        req: DocumentBackfillRequest,
    ) -> Result<BackfillReceipt, BackfillError> {
        self.documents.enqueue(req).await
    }

    async fn backfill_emails(
        &self,
        req: EmailBackfillRequest,
    ) -> Result<BackfillReceipt, BackfillError> {
        self.emails.enqueue(req).await
    }
}
