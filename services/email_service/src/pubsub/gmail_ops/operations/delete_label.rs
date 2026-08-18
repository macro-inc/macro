use email_api_client::domain::models::EmailApiError;
use models_email::gmail::gmail_ops::DeleteLabelPayload;
use models_email::service::link::Link;

use crate::pubsub::gmail_ops::email_api_error::is_delete_label_success;
use crate::pubsub::gmail_ops::worker::GmailOpsContext;

/// Deletes a label from Gmail.
#[tracing::instrument(skip(ctx, link), err)]
pub async fn delete_label(
    ctx: &GmailOpsContext,
    link: &Link,
    payload: &DeleteLabelPayload,
) -> Result<(), EmailApiError> {
    match ctx
        .email_api
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
