use aws_lambda_events::sqs::SqsEvent;
use lambda_runtime::{Error, LambdaEvent, tracing};
use macro_user_id::user_id::MacroUserIdStr;
use memory::domain::{MemoryService, ports::MemoryError};
use memory::domain::service::MemoryServiceImpl;
use memory::outbound::pg_memory_repo::PgMemoryRepo;
use sqs_client::memory::GenerateMemoryMessage;
use std::sync::Arc;

#[tracing::instrument(skip_all)]
pub async fn handler(
    service: Arc<MemoryServiceImpl<PgMemoryRepo>>,
    event: LambdaEvent<SqsEvent>,
) -> Result<(), Error> {
    if event.payload.records.len() != 1 {
        tracing::error!(
            count = event.payload.records.len(),
            "expected exactly 1 SQS record, queue may be misconfigured"
        );
        return Err(Error::from("expected exactly 1 SQS record"));
    }

    let record = &event.payload.records[0];
    let body = record
        .body
        .as_deref()
        .ok_or_else(|| Error::from("SQS record has no body"))?;

    let message: GenerateMemoryMessage = serde_json::from_str(body)
        .map_err(|e| Error::from(format!("failed to deserialize message: {e}")))?;

    let user_id: MacroUserIdStr<'static> = message
        .user_id
        .try_into()
        .map_err(|_| Error::from("invalid user id in SQS message"))?;

    tracing::info!(%user_id, "generating memory");

    match service.generate_memory(user_id).await {
        Ok(_) => {
            tracing::info!("memory generated successfully");
            Ok(())
        }
        Err(MemoryError::Rejected(reason)) => {
            tracing::warn!(%reason, "memory rejected by judge, not retrying");
            Ok(())
        }
        Err(e) => {
            tracing::error!(error=?e, "memory generation failed");
            Err(Error::from(format!("memory generation failed: {e}")))
        }
    }
}
