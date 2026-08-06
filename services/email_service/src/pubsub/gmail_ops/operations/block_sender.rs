use email_api_client::domain::models::EmailApiError;
use models_email::gmail::gmail_ops::BlockSenderPayload;
use models_email::service::link::Link;

use crate::pubsub::gmail_ops::worker::GmailOpsContext;

/// Creates a filter to block a sender in Gmail.
#[tracing::instrument(skip(ctx, link), err)]
pub async fn block_sender(
    ctx: &GmailOpsContext,
    link: &Link,
    payload: &BlockSenderPayload,
) -> Result<(), EmailApiError> {
    ctx.email_api
        .block_sender(link.id, &payload.email_address)
        .await
}
