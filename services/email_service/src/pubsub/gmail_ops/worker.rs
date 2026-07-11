use crate::pubsub::gmail_ops::process;
use crate::util::redis::RedisClient;
use authentication_service_client::AuthServiceClient;
use futures::StreamExt;
use gmail_client::GmailClient;
use sqlx::PgPool;

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
            async move {
                loop {
                    match worker.receive_messages().await {
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

        match worker_result {
            Ok(_) => {
                tracing::error!("gmail ops worker exited successfully?");
            }
            Err(e) => {
                tracing::error!(error=?e, "gmail ops worker crashed with error");
            }
        }

        tracing::info!("GMAIL OPS WORKER RESTARTING...");
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }
}
