use super::*;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

pub(crate) struct MetadataTransaction(pub sqlx::Transaction<'static, sqlx::Postgres>);

fn database_error(source: anyhow::Error) -> BackfillDatabaseError {
    let sqlstates = source
        .chain()
        .filter_map(|cause| {
            cause
                .downcast_ref::<sqlx::Error>()?
                .as_database_error()?
                .code()
                .map(|code| code.into_owned())
        })
        .collect();
    BackfillDatabaseError { source, sqlstates }
}

impl BackfillMetadataTransaction for MetadataTransaction {
    async fn update_metadata(
        &mut self,
        thread: Uuid,
        link: Uuid,
    ) -> Result<(), BackfillDatabaseError> {
        email_db_client::threads::update::update_thread_metadata(&mut self.0, thread, link)
            .await
            .map_err(database_error)
    }
    async fn update_replying_to(
        &mut self,
        thread: Uuid,
        link: Uuid,
    ) -> Result<(), BackfillDatabaseError> {
        email_db_client::messages::replying_to_id::update_thread_messages_replying_to(
            &mut self.0,
            thread,
            link,
        )
        .await
        .map_err(database_error)
    }
    async fn complete(self, result: Result<(), ProcessingError>) -> Result<(), ProcessingError> {
        if let Err(err) = result {
            if let Err(rollback_err) = self.0.rollback().await {
                return Err(ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: anyhow::Error::from(rollback_err).context(format!(
                        "Transaction failed: {} AND rollback also failed",
                        err
                    )),
                }));
            }
            return Err(err);
        }

        self.0.commit().await.map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: anyhow::Error::from(e)
                    .context("Failed to commit transaction for update metadata"),
            })
        })?;
        Ok(())
    }
}
