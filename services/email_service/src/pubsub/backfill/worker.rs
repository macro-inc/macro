use crate::outbound::email_api::GmailApi;
use crate::pubsub::backfill::process;
use crate::pubsub::context::{
    CrmServiceType, NotificationIngressType, PubSubContext, PubSubEventBroker,
};
use crate::pubsub::worker_lifecycle::run_until_cancelled;
use crate::util::redis::RedisClient;
use connection_gateway_client::client::ConnectionGatewayClient;
use contacts::domain::service::SqsContactsIngress;
use contacts::outbound::ingress::SqsContactsQueue;
use document_storage_service_client::DocumentStorageServiceClient;
use futures::StreamExt;
use static_file_service_client::StaticFileServiceClient;
use std::sync::Arc;
use system_properties::{PgSystemPropertiesRepository, SystemPropertiesServiceImpl};
use tokio_util::sync::CancellationToken;

/// Listener capabilities, assembled once from the existing worker inputs.
#[derive(Clone)]
pub(crate) struct BackfillContext {
    pub(crate) sqs_worker: sqs_worker::SQSWorker,
    pub(crate) service: Arc<crate::outbound::backfill_jobs::worker::Backfill>,
}

/// method that ingests sqs messages and calls the process function for each
#[expect(clippy::too_many_arguments, reason = "too annoying to fix right now")]
pub async fn run_worker(
    db: sqlx::Pool<sqlx::Postgres>,
    worker: sqs_worker::SQSWorker,
    sqs_client: sqs_client::SQS,
    contacts_ingress: Arc<SqsContactsIngress<SqsContactsQueue>>,
    email_api: GmailApi,
    redis_client: RedisClient,
    notification_ingress_service: Arc<NotificationIngressType>,
    sfs_client: StaticFileServiceClient,
    connection_gateway_client: ConnectionGatewayClient,
    dss_client: DocumentStorageServiceClient,
    system_properties_service: Arc<SystemPropertiesServiceImpl<PgSystemPropertiesRepository>>,
    crm_service: CrmServiceType,
    macro_event_broker: PubSubEventBroker,
    notifications_enabled: bool,
) {
    run_worker_with_cancellation(
        db,
        worker,
        sqs_client,
        contacts_ingress,
        email_api,
        redis_client,
        notification_ingress_service,
        sfs_client,
        connection_gateway_client,
        dss_client,
        system_properties_service,
        crm_service,
        macro_event_broker,
        notifications_enabled,
        CancellationToken::new(),
    )
    .await;
}

/// Builds the production context for the worker loop.
#[expect(
    clippy::too_many_arguments,
    reason = "preserves the worker composition inputs"
)]
pub(crate) fn context(
    db: sqlx::Pool<sqlx::Postgres>,
    worker: &sqs_worker::SQSWorker,
    sqs_client: sqs_client::SQS,
    contacts_ingress: Arc<SqsContactsIngress<SqsContactsQueue>>,
    email_api: GmailApi,
    redis_client: RedisClient,
    notification_ingress_service: Arc<NotificationIngressType>,
    sfs_client: StaticFileServiceClient,
    connection_gateway_client: ConnectionGatewayClient,
    dss_client: DocumentStorageServiceClient,
    system_properties_service: Arc<SystemPropertiesServiceImpl<PgSystemPropertiesRepository>>,
    crm_service: CrmServiceType,
    macro_event_broker: PubSubEventBroker,
    notifications_enabled: bool,
) -> BackfillContext {
    let leaves = PubSubContext {
        gmail_history: email::domain::mailbox::gmail_history::GmailHistoryService(
            email::outbound::mailbox_pg::PgMailboxSync::new(db.clone()),
        ),
        invitation_extractor: crate::pubsub::invitation_extraction::compose(
            db.clone(),
            email_api.clone(),
        ),
        db,
        sqs_worker: worker.clone(),
        sqs_client,
        contacts_ingress,
        email_api,
        redis_client,
        notification_ingress_service,
        sfs_client,
        connection_gateway_client,
        dss_client,
        system_properties_service,
        crm_service,
        macro_event_broker,
        notifications_enabled,
        retry_worker: false,
    };
    use crate::outbound::backfill_jobs::worker::*;
    BackfillContext {
        sqs_worker: leaves.sqs_worker.clone(),
        service: Arc::new(email::domain::backfill_jobs::worker::BackfillService {
            repository: PgBackfillWorker {
                jobs: crate::outbound::backfill_jobs::PgBackfillJobs(leaves.db.clone()),
            },
            gmail: GmailBackfill(leaves.email_api.clone()),
            queue: BackfillSqs(leaves.sqs_client.clone()),
            effects: BackfillWorkerEffects(leaves.clone()),
            crm: BackfillWorkerCrm(leaves.crm_service.clone()),
            contacts_sync: cfg!(feature = "contacts_sync"),
            attachment_upload: cfg!(feature = "attachment_upload"),
        }),
    }
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
    email_api: GmailApi,
    redis_client: RedisClient,
    notification_ingress_service: Arc<NotificationIngressType>,
    sfs_client: StaticFileServiceClient,
    connection_gateway_client: ConnectionGatewayClient,
    dss_client: DocumentStorageServiceClient,
    system_properties_service: Arc<SystemPropertiesServiceImpl<PgSystemPropertiesRepository>>,
    crm_service: CrmServiceType,
    macro_event_broker: PubSubEventBroker,
    notifications_enabled: bool,
    cancellation_token: CancellationToken,
) {
    let ctx = context(
        db,
        &worker,
        sqs_client,
        contacts_ingress,
        email_api,
        redis_client,
        notification_ingress_service,
        sfs_client,
        connection_gateway_client,
        dss_client,
        system_properties_service,
        crm_service,
        macro_event_broker,
        notifications_enabled,
    );

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
