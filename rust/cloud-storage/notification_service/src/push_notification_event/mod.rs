use anyhow::Context;
use futures::StreamExt;

#[derive(Debug, serde::Deserialize)]
enum EventType {
    #[serde(rename = "DeliveryFailure")]
    DeliveryFailure,
    #[serde(rename = "EndpointDeleted")]
    EndpointDeleted,
}

#[derive(Debug, serde::Deserialize)]
struct SnsPushNotificationEvent {
    // #[serde(rename = "DeliveryAttempts")]
    // delivery_attempts: u32,
    #[serde(rename = "EndpointArn")]
    endpoint_arn: String,
    #[serde(rename = "EventType")]
    event_type: EventType,
    // #[serde(rename = "FailureMessage")]
    // failure_message: String,
    // #[serde(rename = "FailureType")]
    // failure_type: String,
    // #[serde(rename = "MessageId")]
    // message_id: String,
    // #[serde(rename = "Resource")]
    // resource: String,
    // #[serde(rename = "Service")]
    // service: String,
    // #[serde(rename = "Time")]
    // time: String,
}

/// Runs the push notification event worker in a loop to handle restarting should it fail.
pub async fn run_push_notification_event_worker(
    db: sqlx::Pool<sqlx::Postgres>,
    sns_client: sns_client::SNS,
    push_notification_event_handler_worker: sqs_worker::SQSWorker,
) {
    loop {
        let worker_result = tokio::spawn({
            let db = db.clone();
            let worker = push_notification_event_handler_worker.clone();
            let sns_client = sns_client.clone();
            async move {
                tracing::info!("initiated push notification event handler worker");
                loop {
                    match worker.receive_messages().await {
                        Ok(messages) => {
                            if messages.is_empty() {
                                continue;
                            }
                            futures::stream::iter(messages.iter())
                                .then(|message| {
                                    let db = db.clone();
                                    let worker = worker.clone();
                                    let sns_client = sns_client.clone();
                                    async move {
                                        handle_message(&db, &sns_client, &worker, message).await
                                    }
                                })
                                .collect::<Vec<anyhow::Result<()>>>()
                                .await;
                        }
                        Err(e) => {
                            tracing::error!(error=?e, "error receiving messages");
                        }
                    }
                }
            }
        })
        .await;

        match worker_result {
            Ok(_) => {
                // This should never be hit
                tracing::error!("worker exited successfully?");
            }
            Err(e) => {
                tracing::error!(error=?e, "worker crashed with error");
            }
        }

        // Add a delay before restarting to avoid rapid restart loops
        tracing::info!("PUSH NOTIFICATION EVENT WORKER RESTARTING...");
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }
}

/// Processes a push notification event message
#[tracing::instrument(skip(db, sns_client, worker, message))]
pub async fn handle_message(
    db: &sqlx::Pool<sqlx::Postgres>,
    sns_client: &sns_client::SNS,
    worker: &sqs_worker::SQSWorker,
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<()> {
    tracing::info!(message=?message, "processing push notification event");

    let sns_push_notification_event: SnsPushNotificationEvent = serde_json::from_slice(
        message
            .body
            .as_ref()
            .context("failed to get body")?
            .as_bytes(),
    )
    .context("unable to deserialize message")?;

    // we may eventually want to handle the events separately but for now we can easily just delete
    // the endpoints
    tracing::info!(
        device_endpoint=sns_push_notification_event.endpoint_arn,
        event_type=?sns_push_notification_event.event_type,
        "deleting endpoint"
    );

    notification_db_client::device::delete_user_device_by_endpoint(
        db,
        &sns_push_notification_event.endpoint_arn,
    )
    .await
    .context("unable to delete endpoint")?;

    match sns_push_notification_event.event_type {
        EventType::DeliveryFailure => {
            sns_client
                .delete_endpoint(&sns_push_notification_event.endpoint_arn)
                .await
                .context("unable to delete endpoint")?;
        }
        EventType::EndpointDeleted => {}
    }

    cleanup_message(worker, message)
        .await
        .context("unable to delete message")?;

    Ok(())
}

async fn cleanup_message(
    worker: &sqs_worker::SQSWorker,
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<()> {
    if let Some(receipt_handle) = message.receipt_handle.as_ref() {
        tracing::trace!(message_id=?message.message_id, message_receipt_handle=?receipt_handle, "deleting message");
        worker.delete_message(receipt_handle).await?;
    }
    Ok(())
}
