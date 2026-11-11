//! Stage-A bridge used only by the unchanged history and upsert implementations.

use crate::outbound::inbox_lifecycle::inbox_sync::InboxSyncSqs;
use crate::pubsub::context::PubSubContext;
use email_api_client::domain::models::EmailApiError;
use models_email::gmail::inbox_sync::InboxSyncOperation;
use models_email::service::pubsub::ProcessingError;

pub(crate) async fn handle_operation_error(
    ctx: &PubSubContext,
    link_id: uuid::Uuid,
    operation: InboxSyncOperation,
    error: EmailApiError,
) -> ProcessingError {
    email::domain::mailbox::inbox_sync::handle_operation_error(
        &InboxSyncSqs(ctx.sqs_client.clone()),
        ctx.retry_worker,
        link_id,
        operation,
        error,
    )
    .await
}
