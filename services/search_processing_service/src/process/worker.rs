use crate::process::{self, context::SearchProcessingContext};
use futures::StreamExt;

/// How long a worker processes one message before giving up on it.
pub(crate) const MESSAGE_PROCESSING_TIMEOUT: std::time::Duration =
    std::time::Duration::from_secs(300);

/// How long a worker holding backfill units waits for its first message.
const ADMITTED_RECEIVE_WAIT_SECONDS: i32 = 2;

/// How long a worker that found the queue empty waits, holding no units,
/// before it asks again: the rest of the queue's long-poll wait, so an idle
/// worker asks no more often than a long-polling one would.
fn idle_backoff(ctx: &SearchProcessingContext) -> std::time::Duration {
    let rest = ctx.worker.wait_time_seconds() - ADMITTED_RECEIVE_WAIT_SECONDS;
    std::time::Duration::from_secs(u64::try_from(rest).unwrap_or(0))
}

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

                    // Units are taken before the receive, so a paused or
                    // capped worker leaves messages on the queue instead of
                    // holding them; the short wait keeps an idle worker from
                    // holding units another backfill could use.
                    let mut batch = ctx.backfill_gate.admit_up_to(ctx.messages_per_receive).await;
                    let wanted = i32::try_from(batch.units()).unwrap_or(1);
                    match ctx
                        .worker
                        .receive_messages_up_to(wanted, ADMITTED_RECEIVE_WAIT_SECONDS)
                        .await
                    {
                        Ok(messages) => {
                            if messages.is_empty() {
                                drop(batch);
                                tokio::time::sleep(idle_backoff(&ctx)).await;
                                continue;
                            }
                            let admitted: Vec<_> = messages
                                .into_iter()
                                .map(|message| (message, batch.take_one()))
                                .collect();
                            drop(batch);
                            let result = futures::stream::iter(admitted)
                                .map(|(message, permit)| {
                                    let ctx = ctx.clone();
                                    async move {
                                        let result = tokio::time::timeout(
                                            MESSAGE_PROCESSING_TIMEOUT,
                                            process::process_message(&ctx, &message)
                                        ).await;
                                        drop(permit);

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
                                .buffer_unordered(10)
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
