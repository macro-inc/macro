use aws_lambda_events::event::eventbridge::EventBridgeEvent;
use lambda_runtime::{Error, LambdaEvent, tracing};
use memory::outbound::pg_memory_repo::PgMemoryRepo;
use std::sync::Arc;

const PAGE_SIZE: i64 = 100;

#[tracing::instrument(skip_all)]
pub async fn handler(
    repo: Arc<PgMemoryRepo>,
    sqs: Arc<sqs_client::SQS>,
    _event: LambdaEvent<EventBridgeEvent>,
) -> Result<(), Error> {
    let mut cursor = None;
    let mut total = 0u64;

    loop {
        let users = repo
            .get_eligible_users_for_memory_generation(cursor.as_ref(), PAGE_SIZE)
            .await
            .map_err(|e| Error::from(format!("failed to query eligible users: {e}")))?;

        if users.is_empty() {
            break;
        }

        let count = users.len();
        cursor = users.last().cloned();

        sqs.bulk_enqueue_memory_generation(&users)
            .await
            .map_err(|e| Error::from(format!("failed to enqueue memory generation: {e}")))?;

        total += count as u64;
        tracing::info!(enqueued = count, total, "enqueued batch of memory generation requests");
    }

    tracing::info!(total, "memory scheduler complete");
    Ok(())
}
