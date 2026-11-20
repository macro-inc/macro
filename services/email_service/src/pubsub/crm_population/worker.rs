use super::process;
use crate::composition::workers::CrmServiceType;
use crate::pubsub::worker_lifecycle::run_until_cancelled;
use crate::util::redis::RedisClient;
use email::domain::crm_population::FleetAdmission;
use rand::Rng;
use std::sync::Arc;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

/// Shortest and longest pause before a worker asks again for a fleet slot.
const FLEET_BUSY_PAUSE: std::ops::RangeInclusive<Duration> =
    Duration::from_secs(1)..=Duration::from_secs(3);
/// Pause after the fleet slots could not be read, or a receive failed.
const UNAVAILABLE_PAUSE: Duration = Duration::from_secs(5);

/// A population worker's queue handle and composed service.
#[derive(Clone)]
pub(crate) struct CrmPopulationContext {
    pub(crate) sqs_worker: sqs_worker::SQSWorker,
    pub(crate) service: Arc<crate::outbound::crm_population::CrmPopulationConsumer>,
}

/// Builds a worker's context. `db` is the population pool, separate from the
/// pools inbox sync and backfill use, and `crm_service` runs on it.
pub(crate) fn context(
    db: sqlx::PgPool,
    worker: &sqs_worker::SQSWorker,
    sqs_client: sqs_client::SQS,
    redis_client: RedisClient,
    crm_service: CrmServiceType,
) -> CrmPopulationContext {
    use crate::outbound::backfill_jobs::worker::BackfillWorkerCrm;
    use crate::outbound::crm_population::{PgPopulationMailboxes, RedisPopulationSlots, requests};
    CrmPopulationContext {
        sqs_worker: worker.clone(),
        service: Arc::new(email::domain::crm_population::CrmPopulationService {
            requests: requests(redis_client.clone(), sqs_client),
            slots: RedisPopulationSlots(redis_client),
            mailboxes: PgPopulationMailboxes(db),
            crm: BackfillWorkerCrm(crm_service),
        }),
    }
}

/// Runs populations until cancellation is requested.
///
/// A worker takes one of the fleet's population slots before it receives, so
/// a busy fleet leaves messages queued. A message already received is
/// processed before shutdown.
pub fn run_worker_with_cancellation(
    db: sqlx::PgPool,
    worker: sqs_worker::SQSWorker,
    sqs_client: sqs_client::SQS,
    redis_client: RedisClient,
    crm_service: CrmServiceType,
    cancellation_token: CancellationToken,
) -> impl Future<Output = ()> {
    let ctx = context(db, &worker, sqs_client, redis_client, crm_service);
    run(ctx, cancellation_token)
}

async fn run(ctx: CrmPopulationContext, cancellation_token: CancellationToken) {
    loop {
        let worker_result = tokio::spawn({
            let ctx = ctx.clone();
            let cancellation_token = cancellation_token.clone();
            async move { receive_while_running(&ctx, &cancellation_token).await }
        })
        .await;

        if cancellation_token.is_cancelled() {
            return;
        }
        if let Err(error) = worker_result {
            tracing::error!(error = ?error, "CRM population worker crashed");
        }

        // Pause before restarting to avoid rapid restart loops.
        if pause(&cancellation_token, Duration::from_secs(5))
            .await
            .is_none()
        {
            return;
        }
    }
}

async fn receive_while_running(ctx: &CrmPopulationContext, cancellation_token: &CancellationToken) {
    loop {
        let Some(admitted) =
            run_until_cancelled(cancellation_token, ctx.service.fleet_slot()).await
        else {
            return;
        };
        let slot = match admitted {
            FleetAdmission::Admitted(slot) => slot,
            FleetAdmission::Busy => {
                let wait = rand::rng().random_range(FLEET_BUSY_PAUSE);
                if pause(cancellation_token, wait).await.is_none() {
                    return;
                }
                continue;
            }
            FleetAdmission::Unavailable => {
                if pause(cancellation_token, UNAVAILABLE_PAUSE).await.is_none() {
                    return;
                }
                continue;
            }
        };

        let running = slot
            .hold(async {
                let received =
                    run_until_cancelled(cancellation_token, ctx.sqs_worker.receive_messages())
                        .await?;
                match received {
                    Ok(messages) => {
                        for message in &messages {
                            if let Err(error) = process::process_message(ctx, message).await {
                                tracing::error!(
                                    message_id = message.message_id.as_deref().unwrap_or_default(),
                                    error = ?error,
                                    "error processing a CRM population"
                                );
                            }
                        }
                    }
                    Err(error) => {
                        tracing::error!(error = ?error, "error receiving CRM populations");
                        pause(cancellation_token, UNAVAILABLE_PAUSE).await?;
                    }
                }
                Some(())
            })
            .await;
        if running.is_none() {
            return;
        }
    }
}

async fn pause(cancellation_token: &CancellationToken, duration: Duration) -> Option<()> {
    run_until_cancelled(cancellation_token, tokio::time::sleep(duration)).await
}
