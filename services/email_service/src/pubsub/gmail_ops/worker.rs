use crate::pubsub::gmail_ops::process;
use crate::pubsub::worker_lifecycle::run_until_cancelled;
use crate::util::redis::RedisClient;
use authentication_service_client::AuthServiceClient;
use futures::StreamExt;
use gmail_client::GmailClient;
use sqlx::PgPool;
use tokio_util::sync::CancellationToken;

/// Context for the Gmail operations worker. Simpler than PubSubContext since
/// these operations only need Gmail API access and DB for reverts.
#[derive(Clone)]
pub struct GmailOpsContext {
    pub db: PgPool,
    pub sqs_worker: sqs_worker::SQSWorker,
    pub sqs_client: sqs_client::SQS,
    pub gmail_client: GmailClient,
    pub auth_service_client: AuthServiceClient,
    pub redis_client: RedisClient,
    pub retry_worker: bool,
}

/// Runs the Gmail operations worker, processing messages from the queue.
pub async fn run_worker(
    db: PgPool,
    worker: sqs_worker::SQSWorker,
    sqs_client: sqs_client::SQS,
    gmail_client: GmailClient,
    auth_service_client: AuthServiceClient,
    redis_client: RedisClient,
    retry_worker: bool,
) {
    run_worker_with_cancellation(
        db,
        worker,
        sqs_client,
        gmail_client,
        auth_service_client,
        redis_client,
        retry_worker,
        CancellationToken::new(),
    )
    .await;
}

/// Ingests Gmail operations messages until cancellation is requested.
///
/// A batch already returned by SQS is fully processed before shutdown.
#[allow(clippy::too_many_arguments)]
pub async fn run_worker_with_cancellation(
    db: PgPool,
    worker: sqs_worker::SQSWorker,
    sqs_client: sqs_client::SQS,
    gmail_client: GmailClient,
    auth_service_client: AuthServiceClient,
    redis_client: RedisClient,
    retry_worker: bool,
    cancellation_token: CancellationToken,
) {
    let ctx = GmailOpsContext {
        db,
        sqs_worker: worker.clone(),
        sqs_client,
        gmail_client,
        auth_service_client,
        redis_client,
        retry_worker,
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
                            let result = futures::stream::iter(messages.iter())
                                .then(|message| {
                                    let ctx = ctx.clone();
                                    async move {
                                        let result =
                                            process::process_message(ctx, message).await;

                                        match result {
                                            Ok(_) => Ok(()),
                                            Err(e) => Err((
                                                message
                                                    .message_id
                                                    .clone()
                                                    .unwrap_or_default(),
                                                e,
                                            )),
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
                                    tracing::error!(message_id, error=?error, "error processing gmail ops message");
                                }
                            }
                        }
                        Err(e) => {
                            tracing::error!(error=?e, "error receiving gmail ops messages");
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
                tracing::error!("gmail ops worker exited successfully?");
            }
            Err(e) => {
                tracing::error!(error=?e, "gmail ops worker crashed with error");
            }
        }

        tracing::info!("GMAIL OPS WORKER RESTARTING...");
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
