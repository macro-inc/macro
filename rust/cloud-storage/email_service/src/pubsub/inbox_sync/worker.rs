use crate::pubsub::context::{CrmServiceType, NotificationIngressType, PubSubContext};
use crate::pubsub::inbox_sync::process;
use crate::util::redis::RedisClient;
use authentication_service_client::AuthServiceClient;
use connection_gateway_client::client::ConnectionGatewayClient;
use contacts::domain::service::SqsContactsIngress;
use contacts::outbound::ingress::SqsContactsQueue;
use document_storage_service_client::DocumentStorageServiceClient;
use futures::StreamExt;
use static_file_service_client::StaticFileServiceClient;
use std::sync::Arc;
use system_properties::{PgSystemPropertiesRepository, SystemPropertiesServiceImpl};

/// method that ingests sqs messages and calls the process function for each
#[expect(clippy::too_many_arguments, reason = "too annoying to fix right now")]
pub async fn run_worker(
    db: sqlx::Pool<sqlx::Postgres>,
    worker: sqs_worker::SQSWorker,
    sqs_client: sqs_client::SQS,
    contacts_ingress: Arc<SqsContactsIngress<SqsContactsQueue>>,
    gmail_client: gmail_client::GmailClient,
    auth_service_client: AuthServiceClient,
    redis_client: RedisClient,
    notification_ingress_service: Arc<NotificationIngressType>,
    sfs_client: StaticFileServiceClient,
    connection_gateway_client: ConnectionGatewayClient,
    dss_client: DocumentStorageServiceClient,
    system_properties_service: Arc<SystemPropertiesServiceImpl<PgSystemPropertiesRepository>>,
    crm_service: CrmServiceType,
    notifications_enabled: bool,
    retry_worker: bool,
) {
    let ctx = PubSubContext {
        db,
        sqs_worker: worker.clone(),
        sqs_client,
        contacts_ingress,
        gmail_client,
        auth_service_client,
        redis_client,
        notification_ingress_service,
        sfs_client,
        connection_gateway_client,
        dss_client,
        system_properties_service,
        crm_service,
        notifications_enabled,
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
                                        let result = process::process_message(
                                            ctx,
                                            message
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
