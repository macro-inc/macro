use crate::pubsub::context::{
    CalendarBackfillServices, CrmServiceType, NotificationIngressType, PubSubContext,
    PubSubEventBroker,
};
use crate::pubsub::inbox_sync::process;
use crate::pubsub::worker_lifecycle::run_until_cancelled;
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
use tokio_util::sync::CancellationToken;

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
    macro_event_broker: PubSubEventBroker,
    notifications_enabled: bool,
    calendar_sync_enabled: bool,
    retry_worker: bool,
) {
    run_worker_with_cancellation(
        db,
        worker,
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
        macro_event_broker,
        notifications_enabled,
        calendar_sync_enabled,
        retry_worker,
        CancellationToken::new(),
    )
    .await;
}

/// Ingests SQS messages until cancellation is requested.
///
/// A batch already returned by SQS is fully processed before shutdown.
#[expect(clippy::too_many_arguments, reason = "too annoying to fix right now")]
pub async fn run_worker_with_cancellation(
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
    macro_event_broker: PubSubEventBroker,
    notifications_enabled: bool,
    calendar_sync_enabled: bool,
    retry_worker: bool,
    cancellation_token: CancellationToken,
) {
    let calendar_backfills = CalendarBackfillServices::new(db.clone(), redis_client.clone());
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
        macro_event_broker,
        notifications_enabled,
        calendar_sync_enabled,
        retry_worker,
        calendar_backfills,
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
