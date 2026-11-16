//! Provider operations retain their existing span contracts.

use super::error_policy::is_delete_label_success;
use super::{GmailMailboxOperations, GmailOpsService};
use email_api_client::domain::models::EmailApiError;
use models_email::gmail::gmail_ops::{
    BlockSenderPayload, DeleteLabelPayload, UnblockSenderPayload,
};
use models_email::service::link::Link;

/// Creates a filter to block a sender in Gmail.
#[tracing::instrument(skip(ctx, link, payload), err, fields(link_id = %link.id))]
pub(super) async fn block_sender<R, G: GmailMailboxOperations, Q>(
    ctx: &GmailOpsService<R, G, Q>,
    link: &Link,
    payload: &BlockSenderPayload,
) -> Result<(), EmailApiError> {
    ctx.gmail
        .block_sender(link.id, &payload.email_address)
        .await
}

/// Deletes a label from Gmail.
#[tracing::instrument(skip(ctx, link), err)]
pub(super) async fn delete_label<R, G: GmailMailboxOperations, Q>(
    ctx: &GmailOpsService<R, G, Q>,
    link: &Link,
    payload: &DeleteLabelPayload,
) -> Result<(), EmailApiError> {
    match ctx
        .gmail
        .delete_label(link.id, &payload.provider_label_id)
        .await
    {
        Ok(()) => Ok(()),
        Err(error) if is_delete_label_success(&error) => {
            tracing::warn!(
                provider_label_id = %payload.provider_label_id,
                "Label not found in Gmail when attempting to delete, ignoring"
            );
            Ok(())
        }
        Err(error) => Err(error),
    }
}

/// Finds and removes a block filter for a sender in Gmail.
#[tracing::instrument(skip(ctx, link, payload), err, fields(link_id = %link.id))]
pub(super) async fn unblock_sender<R, G: GmailMailboxOperations, Q>(
    ctx: &GmailOpsService<R, G, Q>,
    link: &Link,
    payload: &UnblockSenderPayload,
) -> Result<(), EmailApiError> {
    ctx.gmail
        .unblock_sender(link.id, &payload.email_address)
        .await
}
