//! Ports (outbound trait contracts) for the backfill domain.
//!
//! Each entity type has its own port because the filter shape differs, but
//! every implementation has the same responsibility: given a filter, page
//! through the source of truth and emit [`SearchQueueMessage`][msg]s onto the
//! search event queue. The request/response types live in [`super::models`].
//!
//! [msg]: sqs_client::search::SearchQueueMessage

use std::future::Future;

use super::models::{
    BackfillError, BackfillReceipt, CallBackfillRequest, ChannelBackfillRequest,
    ChatBackfillRequest, DocumentBackfillRequest, EmailBackfillRequest,
};

pub trait CallBackfill: Send + Sync + 'static {
    fn enqueue(
        &self,
        req: CallBackfillRequest,
    ) -> impl Future<Output = Result<BackfillReceipt, BackfillError>> + Send;
}

pub trait ChatBackfill: Send + Sync + 'static {
    fn enqueue(
        &self,
        req: ChatBackfillRequest,
    ) -> impl Future<Output = Result<BackfillReceipt, BackfillError>> + Send;
}

pub trait ChannelBackfill: Send + Sync + 'static {
    fn enqueue(
        &self,
        req: ChannelBackfillRequest,
    ) -> impl Future<Output = Result<BackfillReceipt, BackfillError>> + Send;
}

pub trait DocumentBackfill: Send + Sync + 'static {
    fn enqueue(
        &self,
        req: DocumentBackfillRequest,
    ) -> impl Future<Output = Result<BackfillReceipt, BackfillError>> + Send;
}

pub trait EmailBackfill: Send + Sync + 'static {
    fn enqueue(
        &self,
        req: EmailBackfillRequest,
    ) -> impl Future<Output = Result<BackfillReceipt, BackfillError>> + Send;
}
