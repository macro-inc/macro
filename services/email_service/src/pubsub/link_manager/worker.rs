use crate::outbound::email_api::GmailApi;
use crate::pubsub::context::{CrmServiceType, NotificationIngressType, PubSubEventBroker};
use crate::pubsub::link_manager::context::LinkManagerContext;
use crate::pubsub::link_manager::process;
use crate::pubsub::worker_lifecycle::run_until_cancelled;
use crate::util::redis::RedisClient;
use authentication_service_client::AuthServiceClient;
use connection_gateway_client::client::ConnectionGatewayClient;
use contacts::{domain::service::SqsContactsIngress, outbound::ingress::SqsContactsQueue};
use futures::StreamExt;
use sqlx::PgPool;
use sqs_client::SQS;
use std::convert::Infallible;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::{Instant, MissedTickBehavior, interval_at};
use tokio_util::sync::CancellationToken;
use tracing::Instrument;

#[cfg(test)]
mod test;

/// How long each renewal hides a message being processed from other workers.
const VISIBILITY_EXTENSION_SECONDS: i32 = 300;
/// How often a message being processed renews its visibility. Several renewals fit in one
/// extension, so a failed renewal doesn't expose the message.
const VISIBILITY_RENEWAL_INTERVAL: Duration = Duration::from_secs(60);

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
    contacts_ingress: Arc<SqsContactsIngress<SqsContactsQueue>>,
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
        contacts_ingress,
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
    contacts_ingress: Arc<SqsContactsIngress<SqsContactsQueue>>,
    cancellation_token: CancellationToken,
) {
    let outlook = loop {
        let result = async {
            let connection = redis_client
                .inner
                .get_multiplexed_async_connection()
                .await?;
            Ok::<_, anyhow::Error>(email_api_client::OutlookApiClientRepository::with_gate(
                Arc::new(crate::outbound::email_api::RedisMicrosoftRequestGate(
                    connection,
                )),
            )?)
        }
        .await;
        match result {
            Ok(provider) => break provider,
            Err(error) => tracing::warn!(
                ?error,
                "Inbox lifecycle client initialization failed; retrying"
            ),
        }
        if run_until_cancelled(
            &cancellation_token,
            tokio::time::sleep(std::time::Duration::from_secs(2)),
        )
        .await
        .is_none()
        {
            return;
        }
    };
    let ctx = LinkManagerContext {
        inbox_lifecycle: Arc::new(crate::composition::inbox_lifecycle(
            outlook,
            db.clone(),
            auth_service_client.clone(),
            sqs_client.clone(),
            connection_gateway_client.clone(),
        )),
        inbox_health: Arc::new(crate::composition::inbox_health(
            db.clone(),
            email_api.clone(),
            auth_service_client.clone(),
            redis_client.clone(),
            sqs_client.clone(),
            macro_event_broker.clone(),
            contacts_ingress,
        )),
        db,
        sqs_worker: worker.clone(),
        email_api,
        auth_service_client,
        redis_client,
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
                                    let worker = &worker;
                                    let span = tracing::info_span!(
                                        "email.link_manager.message",
                                        message_id = message.message_id.as_deref(),
                                    );
                                    async move {
                                        let result = while_renewing_visibility(
                                            || {
                                                worker.extend_visibility(
                                                    message,
                                                    VISIBILITY_EXTENSION_SECONDS,
                                                )
                                            },
                                            process::process_message(ctx, message),
                                        )
                                        .instrument(span)
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

/// Runs `work` while calling `renew` every [`VISIBILITY_RENEWAL_INTERVAL`], so a message
/// that outlives the queue's visibility timeout (a large mailbox purge) isn't redelivered
/// and processed a second time while the first run is still going.
async fn while_renewing_visibility<T, R, RenewFuture>(renew: R, work: impl Future<Output = T>) -> T
where
    R: FnMut() -> RenewFuture,
    RenewFuture: Future<Output = anyhow::Result<()>>,
{
    tokio::select! {
        output = work => output,
        never = renew_visibility(renew) => match never {},
    }
}

async fn renew_visibility<R, RenewFuture>(mut renew: R) -> Infallible
where
    R: FnMut() -> RenewFuture,
    RenewFuture: Future<Output = anyhow::Result<()>>,
{
    let mut ticks = interval_at(
        Instant::now() + VISIBILITY_RENEWAL_INTERVAL,
        VISIBILITY_RENEWAL_INTERVAL,
    );
    ticks.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        ticks.tick().await;
        // A failed renewal is retried on the next tick; the work keeps running either way.
        renew().await.ok();
    }
}
