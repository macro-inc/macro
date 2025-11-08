mod comms_utils;
pub mod context;
mod create;
mod metadata_utils;
mod process;
mod rate_limit;
pub mod send;
mod user_data;
mod user_ids;

/// Runs the notification worker in a loop to handle restarting should it fail.
pub async fn run_notification_worker(queue_worker_context: context::QueueWorkerContext) {
    use futures::StreamExt;
    loop {
        let worker_result = tokio::spawn({
            let queue_worker_context = queue_worker_context.clone();
            async move {
                tracing::info!("notification worker started");
                loop {
                    match queue_worker_context.worker.receive_messages().await {
                        Ok(messages) => {
                            if messages.is_empty() {
                                continue;
                            }

                            futures::stream::iter(messages.iter())
                                .then(|message| {
                                    let queue_worker_context = queue_worker_context.clone();
                                    async move {
                                        let processing_future = process::process_message(queue_worker_context,message);
                                        let result = tokio::time::timeout(std::time::Duration::from_secs(30), processing_future).await;

                                        match result {
                                            Ok(Ok(_)) => {}
                                            Ok(Err(e)) => {
                                                tracing::error!(message_id=?message.message_id, error=?e, "error processing message");
                                            }
                                            Err(e) => {
                                                tracing::error!(message_id=?message.message_id, error=?e, "timeout processing message");
                                            }
                                        }
                                        Ok(())
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
                tracing::error!("notification worker exited successfully?");
            }
            Err(e) => {
                tracing::error!(error=?e, "notification worker crashed with error");
            }
        }

        // Add a delay before restarting to avoid rapid restart loops
        tracing::info!("NOTIFICATION WORKER RESTARTING...");
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }
}
