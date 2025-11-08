use super::s3_message;
use crate::api::context::AppState;
use std::time;

enum PollError {
    PollingError,
    _Other,
}

// very important that long polling on the sqs queue is enabled
pub async fn poll_s3_events(context: AppState) {
    loop {
        if let Err(PollError::PollingError) =
            poll(context.config.s3_event_queue_url.clone(), context.clone()).await
        {
            tokio::time::sleep(time::Duration::from_secs(20)).await;
        }
    }
}

#[tracing::instrument(skip(sqs_url, context))]
async fn poll(sqs_url: String, context: AppState) -> Result<(), PollError> {
    let event_response = context
        .sqs_client
        .receive_message()
        .queue_url(sqs_url.to_owned())
        .wait_time_seconds(20)
        .send()
        .await
        .map_err(|e| {
            tracing::warn!("sqs polling request failed: {:?}", e);
            PollError::PollingError
        })?;

    let messages = event_response
        .messages
        .ok_or_else(|| tracing::warn!("no messages in event"))
        .map_err(|_| PollError::PollingError)?;

    for message in messages {
        if let Some(receipt) = &message.receipt_handle {
            let _ = context
                .sqs_client
                .delete_message()
                .queue_url(sqs_url.to_owned())
                .receipt_handle(receipt)
                .send()
                .await
                .map_err(|e| {
                    tracing::error!("failed to delete sqs message {:?}", e);
                    e
                });
            s3_message::handle_s3_message(message, context.metadata_client.clone()).await;
        }
    }
    Ok(())
}
