use crate::util::redis::RedisClient;
use crate::util::redis::rate_limit::RateLimitArgs;
use anyhow::anyhow;
use connection_gateway_client::client::ConnectionGatewayClient;
/// shared utils across different pubsub workers
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use models_email::gmail::operations::GmailApiOperation;
use models_email::service::link::Link;
use sqlx::PgPool;
use uuid::Uuid;

/// Arguments for checking Gmail API rate limits
pub struct CheckGmailRateLimitArgs<'a> {
    pub redis_client: &'a RedisClient,
    pub link_id: Uuid,
    pub gmail_operation: GmailApiOperation,
    pub retryable: bool,
    pub is_backfill: bool,
}

// check if we are rate limited by gmail before making any requests to the api
pub async fn check_gmail_rate_limit(
    args: CheckGmailRateLimitArgs<'_>,
) -> Result<(), ProcessingError> {
    if args
        .redis_client
        .is_rate_limited(RateLimitArgs {
            user_id: args.link_id,
            operation: args.gmail_operation,
            is_backfill: args.is_backfill,
        })
        .await
    {
        return if args.retryable {
            Err(ProcessingError::Retryable(DetailedError {
                reason: FailureReason::GmailApiRateLimited,
                source: anyhow::Error::msg("Gmail API rate limit exceeded"),
            }))
        } else {
            Err(ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::GmailApiRateLimited,
                source: anyhow::Error::msg("Gmail API rate limit exceeded"),
            }))
        };
    }

    Ok(())
}

#[tracing::instrument(skip(tx, result), level = "debug")]
pub async fn complete_transaction_with_processing_error<T>(
    tx: sqlx::Transaction<'_, sqlx::Postgres>,
    result: Result<T, ProcessingError>,
) -> Result<T, ProcessingError> {
    match result {
        Ok(value) => {
            tx.commit().await.map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: anyhow::Error::from(e).context("Failed to commit transaction"),
                })
            })?;

            Ok(value)
        }
        Err(e) => match tx.rollback().await {
            Ok(_) => Err(e),
            Err(rollback_err) => {
                let combined_error = anyhow::anyhow!(
                    "Operation failed AND transaction rollback failed. Original error: {:?}, Rollback error: {:?}",
                    e,
                    rollback_err
                );

                Err(ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: combined_error,
                }))
            }
        },
    }
}

/// Send message to connection gateway to trigger email refresh if user is active on FE
#[tracing::instrument(skip(client), level = "debug")]
pub async fn cg_refresh_email(client: &ConnectionGatewayClient, macro_id: &str, event_type: &str) {
    if cfg!(feature = "connection_gateway") {
        let _ = client
            .refresh_email(macro_id, event_type)
            .await
            .inspect_err(|e| tracing::error!(macro_id = %macro_id, "Failed to refresh email: {e}"));
    }
}

/// Fetches the Link details from the database using the link_id from the notification.
pub async fn fetch_link(db: &PgPool, link_id: Uuid) -> anyhow::Result<Link> {
    email_db_client::links::get::fetch_link_by_id(db, link_id)
        .await
        .map_err(|e| {
            let error_message = "Unable to fetch link from DB";
            tracing::error!(error = ?e, link_id = %link_id, error_message);
            anyhow!(error_message)
        })?
        .ok_or_else(|| {
            let error_message = "Link not found";
            tracing::error!(link_id = %link_id, error_message);
            anyhow!(error_message)
        })
}
