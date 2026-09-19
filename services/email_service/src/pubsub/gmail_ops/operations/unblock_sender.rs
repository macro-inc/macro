use email_api_client::domain::models::EmailApiError;
use models_email::gmail::gmail_ops::UnblockSenderPayload;
use models_email::service::link::Link;

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
