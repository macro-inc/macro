use super::*;
async fn drain(db: &PgPool, sqs: &sqs_client::SQS) -> anyhow::Result<()> {
    email::domain::backfill_jobs::outbox::drain_crm(
        &PgBackfillOutbox(db.clone()),
        &BackfillSqs(sqs.clone()),
    )
    .await
}
mod test;
