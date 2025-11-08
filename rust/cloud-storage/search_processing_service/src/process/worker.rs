use crate::process::{self, context::SearchProcessingContext};
use futures::StreamExt;

/// Spawns multiple search processing workers.
pub fn run_search_processing_workers(ctx: SearchProcessingContext, worker_count: u8) {
    for worker_id in 0..worker_count {
        let ctx_clone = ctx.clone();
        tokio::spawn(async move {
            tracing::info!(worker_id, "spawning worker");
            run_search_processing_worker_with_id(ctx_clone, worker_id).await;
        });
    }
}

#[tracing::instrument(skip(ctx))]
pub async fn run_search_processing_worker_with_id(ctx: SearchProcessingContext, worker_id: u8) {
    loop {
        let worker_result = tokio::spawn({
            let ctx = ctx.clone();
            async move {
                tracing::info!("worker started");
                let mut last_heartbeat = std::time::Instant::now();
                loop {
                    if last_heartbeat.elapsed() > std::time::Duration::from_secs(60) {
                        tracing::info!("worker heartbeat - still running");
                        last_heartbeat = std::time::Instant::now();
                    }

                    match ctx.worker.receive_messages().await {
                        Ok(messages) => {
                            if messages.is_empty() {
                                continue;
                            }
                            let result = futures::stream::iter(messages.iter())
                                .then(|message| {
                                    let ctx = ctx.clone();
                                    async move {
                                        let result = tokio::time::timeout(
                                            std::time::Duration::from_secs(300), // 5 minutes
                                            process::process_message(&ctx, message)
                                        ).await;

                                        match result {
                                            Ok(Ok(_)) => Ok(()),
                                            Ok(Err(e)) => Err((message.message_id.clone().unwrap_or_default(), e)),
                                            Err(_) => {
                                                tracing::error!(
                                                    message_id = message.message_id.as_deref().unwrap_or("unknown"),
                                                    "Message processing timed out after 5 minutes"
                                                );
                                                Err((message.message_id.clone().unwrap_or_default(), anyhow::anyhow!("Processing timeout")))
                                            }
                                        }
                                    }
                                })
                                .collect::<Vec<Result<(), (String, anyhow::Error)>>>()
                                .await;

                            let errors = result
                                .into_iter()
                                .filter_map(|result| result.err())
                                .collect::<Vec<(String, anyhow::Error)>>();

                            if !errors.is_empty() {
                                for (message_id, error) in errors {
                                    tracing::error!(message_id, error=?error, "error processing message");
                                }
                            }
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
        tracing::info!("WORKER RESTARTING...");
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }
}
