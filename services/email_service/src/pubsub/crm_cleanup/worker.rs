use crate::pubsub::context::CrmServiceType;
use crate::pubsub::crm_cleanup::process;
use futures::StreamExt;

/// Shared dependencies for the CRM cleanup handlers. Much smaller than the
/// backfill `PubSubContext` — this worker only talks to the DB, SQS, and the
/// CRM service.
#[derive(Clone)]
pub struct CrmCleanupContext {
    pub db: sqlx::Pool<sqlx::Postgres>,
    pub sqs_worker: sqs_worker::SQSWorker,
    pub sqs_client: sqs_client::SQS,
    pub crm_service: CrmServiceType,
}

/// method that ingests sqs messages and calls the process function for each
pub async fn run_worker(
    db: sqlx::Pool<sqlx::Postgres>,
    worker: sqs_worker::SQSWorker,
    sqs_client: sqs_client::SQS,
    crm_service: CrmServiceType,
) {
    let ctx = CrmCleanupContext {
        db,
        sqs_worker: worker.clone(),
        sqs_client,
        crm_service,
    };

    loop {
        let worker_result = tokio::spawn({
            let ctx = ctx.clone();
            let worker = worker.clone();
            async move {
                loop {
                    match worker.receive_messages().await {
                        Ok(messages) => {
                            if messages.is_empty() {
                                continue;
                            }
                            let results = futures::stream::iter(messages.iter())
                                .then(|message| {
                                    let ctx = ctx.clone();
                                    async move {
                                        process::process_message(ctx, message).await.map_err(|e| {
                                            (
                                                message.message_id.clone().unwrap_or_default(),
                                                e,
                                            )
                                        })
                                    }
                                })
                                .collect::<Vec<Result<(), (String, anyhow::Error)>>>()
                                .await;

                            for (message_id, error) in
                                results.into_iter().filter_map(|result| result.err())
                            {
                                tracing::error!(message_id, error=?error, "error processing crm cleanup message");
                            }
                        }
                        Err(e) => {
                            tracing::error!(error=?e, "error receiving crm cleanup messages");
                        }
                    }
                }
            }
        })
        .await;

        match worker_result {
            Ok(_) => {
                // This should never be hit
                tracing::error!("crm cleanup worker exited successfully?");
            }
            Err(e) => {
                tracing::error!(error=?e, "crm cleanup worker crashed with error");
            }
        }

        // Add a delay before restarting to avoid rapid restart loops
        tracing::info!("CRM CLEANUP WORKER RESTARTING...");
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }
}
