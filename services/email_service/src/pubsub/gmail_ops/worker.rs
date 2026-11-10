use crate::outbound::message_labels::gmail_ops::{GmailOpsProvider, GmailOpsQueue, PgGmailOps};
use crate::pubsub::gmail_ops::process;
use crate::pubsub::worker_lifecycle::run_until_cancelled;
use email::domain::message_labels::gmail_ops::GmailOpsService;
use futures::StreamExt;
use sqlx::PgPool;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

/// The queued label-write use case composed from production adapters.
pub type GmailOpsUseCase = GmailOpsService<PgGmailOps, GmailOpsProvider, GmailOpsQueue>;

/// Domain use case and the SQS handle needed to acknowledge its disposition.
#[derive(Clone)]
pub struct GmailOpsContext {
    pub service: Arc<GmailOpsUseCase>,
    pub sqs_worker: sqs_worker::SQSWorker,
}

/// Runs the Gmail operations worker, processing messages from the queue.
pub async fn run_worker(
    db: PgPool,
    worker: sqs_worker::SQSWorker,
    sqs_client: sqs_client::SQS,
    email_api: impl Into<GmailOpsProvider> + Send + 'static,
    retry_worker: bool,
) {
    run_worker_with_cancellation(
        db,
        worker,
        sqs_client,
        email_api,
        retry_worker,
        CancellationToken::new(),
    )
    .await;
}

/// Builds the production context shared by the worker loop and parity lab.
pub(crate) fn context(
    db: PgPool,
    worker: &sqs_worker::SQSWorker,
    sqs_client: sqs_client::SQS,
    email_api: impl Into<GmailOpsProvider> + Send + 'static,
    retry_worker: bool,
) -> GmailOpsContext {
    GmailOpsContext {
        service: Arc::new(GmailOpsService {
            repository: PgGmailOps(db),
            gmail: email_api.into(),
            retry_queue: GmailOpsQueue(sqs_client),
            retry_worker,
        }),
        sqs_worker: worker.clone(),
    }
}

/// Ingests Gmail operations messages until cancellation is requested.
///
/// A batch already returned by SQS is fully processed before shutdown.
pub async fn run_worker_with_cancellation(
    db: PgPool,
    worker: sqs_worker::SQSWorker,
    sqs_client: sqs_client::SQS,
    email_api: impl Into<GmailOpsProvider> + Send + 'static,
    retry_worker: bool,
    cancellation_token: CancellationToken,
) {
    let ctx = context(db, &worker, sqs_client, email_api, retry_worker);

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
