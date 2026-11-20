//! Durable publication of email backfill outbox rows.
use email::domain::backfill_jobs::outbox::{drain_crm, drain_email_completion, drain_email_init};
use sqlx::PgPool;
use sqs_client::SQS;

/// Continuously publish email backfill and CRM consent requests.
pub fn run(
    db: PgPool,
    sqs: SQS,
    cancellation_token: tokio_util::sync::CancellationToken,
) -> impl Future<Output = ()> {
    run_outbox(db, sqs, cancellation_token)
}
#[tracing::instrument(name = "run", skip(db, sqs))]
async fn run_outbox(db: PgPool, sqs: SQS, cancellation_token: tokio_util::sync::CancellationToken) {
    let db = crate::outbound::backfill_jobs::outbox::PgBackfillOutbox(db);
    let sqs = crate::outbound::backfill_jobs::worker::BackfillSqs(sqs);
    loop {
        if cancellation_token.is_cancelled() {
            return;
        }
        drain_crm(&db, &sqs)
            .await
            .inspect_err(|error| {
                tracing::error!(error = ?error, "failed to publish CRM consent backfill");
            })
            .ok();
        drain_email_init(&db, &sqs)
            .await
            .inspect_err(|error| {
                tracing::error!(error = ?error, "failed to publish email backfill init outbox");
            })
            .ok();
        drain_email_completion(&db, &sqs)
            .await
            .inspect_err(|error| {
                tracing::error!(error = ?error, "failed to publish email completion outbox");
            })
            .ok();
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => {}
            _ = cancellation_token.cancelled() => return,
        }
    }
}
