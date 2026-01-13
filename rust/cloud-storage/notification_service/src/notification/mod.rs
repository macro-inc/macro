use std::time::Duration;

use tokio::time::error::Elapsed;

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
    tracing::info!("notification worker started");
    loop {
        match queue_worker_context.worker.receive_messages().await {
            Ok(messages) => {
                if messages.is_empty() {
                    continue;
                }

                futures::stream::iter(messages)
                    .map(|message| {
                        let ctx = queue_worker_context.clone();
                        async move {
                            let processing_future = process::process_message(ctx, &message);
                            let _ = with_timeout(Duration::from_secs(30), processing_future).await;
                            Ok::<(), anyhow::Error>(())
                        }
                    })
                    .buffer_unordered(10)
                    .collect::<Vec<anyhow::Result<()>>>()
                    .await;
            }
            Err(e) => {
                tracing::error!(error=?e, "error receiving messages");
            }
        }
    }
}

#[tracing::instrument(err, skip(fut))]
async fn with_timeout<F: Future>(duration: Duration, fut: F) -> Result<F::Output, Elapsed> {
    tokio::time::timeout(duration, fut).await
}
