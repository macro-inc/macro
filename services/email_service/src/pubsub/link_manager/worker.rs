use crate::outbound::email_api::GmailApi;
use crate::pubsub::context::{CrmServiceType, NotificationIngressType, PubSubEventBroker};
use crate::pubsub::link_manager::context::LinkManagerContext;
use crate::pubsub::link_manager::process;
use crate::pubsub::worker_lifecycle::run_until_cancelled;
use crate::util::redis::RedisClient;
use authentication_service_client::AuthServiceClient;
use connection_gateway_client::client::ConnectionGatewayClient;
use futures::StreamExt;
use sqlx::PgPool;
use sqs_client::SQS;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

/// method that ingests sqs messages and calls the process function for each
#[allow(clippy::too_many_arguments)]
pub async fn run_worker(
    worker: sqs_worker::SQSWorker,
    db: PgPool,
    email_api: GmailApi,
    auth_service_client: AuthServiceClient,
    redis_client: RedisClient,
    sqs_client: SQS,
    crm_service: CrmServiceType,
    connection_gateway_client: ConnectionGatewayClient,
    notification_ingress_service: Arc<NotificationIngressType>,
    macro_event_broker: PubSubEventBroker,
) {
    run_worker_with_cancellation(
        worker,
        db,
        email_api,
        auth_service_client,
        redis_client,
        sqs_client,
        crm_service,
        connection_gateway_client,
        notification_ingress_service,
        macro_event_broker,
        CancellationToken::new(),
    )
    .await;
}

/// Ingests SQS messages until cancellation is requested.
///
/// A batch already returned by SQS is fully processed before shutdown.
#[allow(clippy::too_many_arguments)]
pub async fn run_worker_with_cancellation(
    worker: sqs_worker::SQSWorker,
    db: PgPool,
    email_api: GmailApi,
    auth_service_client: AuthServiceClient,
    redis_client: RedisClient,
    sqs_client: SQS,
    crm_service: CrmServiceType,
    connection_gateway_client: ConnectionGatewayClient,
    notification_ingress_service: Arc<NotificationIngressType>,
    macro_event_broker: PubSubEventBroker,
    cancellation_token: CancellationToken,
) {
    let ctx = LinkManagerContext {
        db,
        sqs_worker: worker.clone(),
        email_api,
        auth_service_client,
        redis_client,
        sqs_client,
        crm_service,
        connection_gateway_client,
        notification_ingress_service,
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
