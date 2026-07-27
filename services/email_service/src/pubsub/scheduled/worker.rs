use crate::pubsub::context::PubSubEventBroker;
use crate::pubsub::scheduled::context::ScheduledContext;
use crate::pubsub::scheduled::process;
use crate::pubsub::worker_lifecycle::run_until_cancelled;
use crate::util::redis::RedisClient;
use authentication_service_client::AuthServiceClient;
use futures::StreamExt;
use sqlx::PgPool;
use tokio_util::sync::CancellationToken;

/// method that ingests sqs messages and calls the process function for each
#[expect(clippy::too_many_arguments, reason = "matches the other workers")]
pub async fn run_worker(
    worker: sqs_worker::SQSWorker,
    db: PgPool,
    gmail_client: gmail_client::GmailClient,
    auth_service_client: AuthServiceClient,
    redis_client: RedisClient,
    s3_client: s3_client::S3,
    attachment_bucket: String,
    macro_event_broker: PubSubEventBroker,
) {
    run_worker_with_cancellation(
        worker,
        db,
        gmail_client,
        auth_service_client,
        redis_client,
        s3_client,
        attachment_bucket,
        macro_event_broker,
        CancellationToken::new(),
    )
    .await;
}

/// Ingests SQS messages until cancellation is requested.
///
/// A batch already returned by SQS is fully processed before shutdown.
#[expect(clippy::too_many_arguments, reason = "matches the other workers")]
pub async fn run_worker_with_cancellation(
    worker: sqs_worker::SQSWorker,
    db: PgPool,
    gmail_client: gmail_client::GmailClient,
    auth_service_client: AuthServiceClient,
    redis_client: RedisClient,
    s3_client: s3_client::S3,
    attachment_bucket: String,
    macro_event_broker: PubSubEventBroker,
    cancellation_token: CancellationToken,
) {
    let ctx = ScheduledContext {
        db,
        sqs_worker: worker.clone(),
        gmail_client,
        auth_service_client,
        redis_client,
        s3_client,
        attachment_bucket,
        macro_event_broker,
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
                                        let result = process::process_message(
                                            ctx,
                                            message,
                                        )
                                            .await;

                                        match result {
                                            Ok(_) => Ok(()),
                                            Err(e) => Err((
                                                message
                                                    .message_id
                                                    .clone()
                                                    .unwrap_or("".to_string()),
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

        if cancellation_token.is_cancelled() {
            return;
        }

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
