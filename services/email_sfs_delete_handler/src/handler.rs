use crate::context::{self};
use aws_lambda_events::eventbridge::EventBridgeEvent;
use lambda_runtime::{
    Error, LambdaEvent,
    tracing::{self},
};
use sqs_client::email::SFSDeleteMessage;

#[tracing::instrument(skip_all, err)]
pub async fn handler(
    ctx: context::Context,
    _event: LambdaEvent<EventBridgeEvent>,
) -> Result<(), Error> {
    // grab all orphaned sfs attachments (no longer attached to any email attachment)
    let messages = sqlx::query_as!(
        SFSDeleteMessage,
        r#"
        SELECT
            id as "db_id", sfs_id
        FROM email_attachments_sfs
        WHERE
            attachment_id IS NULL
        "#,
    )
    .fetch_all(&ctx.db)
    .await
    .unwrap_or_else(|e| {
        tracing::error!(error=?e, "Error fetching orphaned sfs attachments");
        Vec::new()
    });

    if !messages.is_empty() {
        tracing::info!(count = messages.len(), "Sending sfs delete messages");
    } else {
        tracing::info!("No orphaned sfs attachments found");
    }

    for message in messages.into_iter() {
        let db_id = message.db_id;
        let sfs_id = message.sfs_id;
        if let Err(e) = ctx.sqs_client.enqueue_sfs_delete_message(message).await {
            tracing::error!(
                error = ?e,
                db_id = %db_id,
                sfs_id = %sfs_id,
                "Error enqueueing sfs delete message",
            );
        };
    }

    Ok(())
}
