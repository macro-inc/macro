use crate::pubsub::context::CrmServiceType;
use crate::pubsub::crm_cleanup::process;
use crate::pubsub::worker_lifecycle::run_until_cancelled;
use futures::StreamExt;
use tokio_util::sync::CancellationToken;

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
    run_worker_with_cancellation(
        db,
        worker,
        sqs_client,
        crm_service,
        CancellationToken::new(),
    )
    .await;
}

/// Ingests CRM cleanup messages until cancellation is requested.
///
/// A batch already returned by SQS is fully processed before shutdown.
pub async fn run_worker_with_cancellation(
    db: sqlx::Pool<sqlx::Postgres>,
    worker: sqs_worker::SQSWorker,
    sqs_client: sqs_client::SQS,
    crm_service: CrmServiceType,
    cancellation_token: CancellationToken,
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
            let cancellation_token = cancellation_token.clone();
            async move {
                loop {
                    let Some(receive_result) = run_until_cancelled(
                        &cancellation_token,
                        worker.receive_messages(),
                    )
                    .await
                    else {
                        return;
                    };

                    match receive_result {
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

        if cancellation_token.is_cancelled() {
            return;
        }

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
        if run_until_cancelled(
            &cancellation_token,
            tokio::time::sleep(std::time::Duration::from_secs(5)),
        )
        .await
        .is_none()
        {
            return;
        }
    }
}
