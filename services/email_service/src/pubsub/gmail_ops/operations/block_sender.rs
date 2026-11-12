use email_api_client_core::models::EmailApiError;
use email_types::gmail::gmail_ops::BlockSenderPayload;
use email_types::service::link::Link;

use crate::pubsub::gmail_ops::worker::GmailOpsContext;

/// Creates a filter to block a sender in Gmail.
#[tracing::instrument(skip(ctx, link, payload), err, fields(link_id = %link.id))]
pub async fn block_sender(
    ctx: &GmailOpsContext,
    link: &Link,
    payload: &BlockSenderPayload,
) -> Result<(), EmailApiError> {
    ctx.email_api
        .block_sender(link.id, &payload.email_address)
        .await
}
