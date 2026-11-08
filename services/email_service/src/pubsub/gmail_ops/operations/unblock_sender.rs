use email_api_client_core::models::EmailApiError;
use email_types::gmail::gmail_ops::UnblockSenderPayload;
use email_types::service::link::Link;

use crate::pubsub::gmail_ops::worker::GmailOpsContext;

/// Finds and removes a block filter for a sender in Gmail.
#[tracing::instrument(skip(ctx, link), err)]
pub async fn unblock_sender(
    ctx: &GmailOpsContext,
    link: &Link,
    payload: &UnblockSenderPayload,
) -> Result<(), EmailApiError> {
    ctx.email_api
        .unblock_sender(link.id, &payload.email_address)
        .await
}
