use std::sync::Arc;

use macro_sha_count_client::Redis;
use sync_service_client::SyncServiceClient;

use crate::service::s3::S3;

mod handle;
#[cfg(test)]
mod test;

/// Context for the delete document worker, holding all clients needed to process deletions.
#[derive(Clone)]
pub struct DeleteDocumentWorkerContext {
    pub worker: Arc<sqs_worker::SQSWorker>,
    pub db: sqlx::Pool<sqlx::Postgres>,
    pub s3_client: Arc<S3>,
    pub redis_client: Arc<Redis>,
    pub sync_service_client: Arc<SyncServiceClient>,
}

/// Runs the delete document worker in an infinite loop, restarting on failure.
pub async fn run_worker(ctx: DeleteDocumentWorkerContext) {
    loop {
        let worker_result = tokio::spawn({
            let ctx = ctx.clone();
            async move {
                tracing::info!("delete document worker started");
                loop {
                    match ctx.worker.receive_messages().await {
                        Ok(messages) => {
                            if messages.is_empty() {
                                continue;
                            }

                            let tasks = messages.clone().into_iter().map(|message| {
                                let ctx = ctx.clone();

                                tokio::spawn(async move {
                                    let result = handle::handle(&ctx, &message).await;

                                    if let Err(e) = &result {
                                        tracing::error!(message_id=?message.message_id, error=?e, "error processing delete document message");
                                    }
                                    result
                                })
                            });

                            let handles: Vec<_> = tasks.collect();
                            let results = futures::future::join_all(handles).await;

                            for result in results {
                                if let Err(join_err) = result {
                                    tracing::error!(error=?join_err, "delete document task join error");
                                }
                            }
                        }
                        Err(e) => {
                            tracing::error!(error=?e, "error receiving delete document messages");
                        }
                    }
                }
            }
        })
        .await;

        match worker_result {
            Ok(_) => {
                tracing::error!("delete document worker exited successfully?");
            }
            Err(e) => {
                tracing::error!(error=?e, "delete document worker crashed with error");
            }
        }

        tracing::info!("DELETE DOCUMENT WORKER RESTARTING...");
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }
}
