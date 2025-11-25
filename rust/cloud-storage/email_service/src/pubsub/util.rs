use crate::util::gmail::auth::fetch_gmail_access_token;
use crate::util::redis::RedisClient;
use anyhow::anyhow;
use authentication_service_client::AuthServiceClient;
use connection_gateway_client::client::ConnectionGatewayClient;
use macro_user_id::user_id::MacroUserIdStr;
/// shared utils across different pubsub workers
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use models_email::gmail::operations::GmailApiOperation;
use models_email::service::cache::TokenCacheKey;
use models_email::service::link::Link;
use sqlx::PgPool;
use uuid::Uuid;

// check if we are rate limited by gmail before making any requests to the api
pub async fn check_gmail_rate_limit(
    redis_client: &RedisClient,
    link_id: Uuid,
    gmail_operation: GmailApiOperation,
    retryable: bool, // true for backfill, false for webhook (avoid thundering herd if there is an issue)
) -> Result<(), ProcessingError> {
    if redis_client.is_rate_limited(link_id, gmail_operation).await {
        return if retryable {
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
    #[cfg(not(feature = "disable_connection_gateway"))]
    let _ = client
        .refresh_email(macro_id, event_type)
        .await
        .inspect_err(|e| tracing::error!(macro_id = %macro_id, "Failed to refresh email: {e}"));
}

pub async fn fetch_access_token_for_link(
    redis_client: &RedisClient,
    auth_service_client: &AuthServiceClient,
    link: &Link,
) -> anyhow::Result<String> {
    let cache_key = TokenCacheKey {
        fusion_user_id: link.fusionauth_user_id.clone(),
        macro_id: link.macro_id.to_string(),
        provider: link.provider,
    };

    fetch_gmail_access_token(&cache_key, redis_client, auth_service_client)
        .await
        .map_err(|e| {
            let error_message = "Unable to get Gmail access token";
            tracing::error!(error = ?e, cache_key = ?cache_key, error_message);
            anyhow!(error_message)
        })
}

/// Fetches the Link details from the database using the link_id from the notification.
pub async fn fetch_link(db: &PgPool, link_id: Uuid) -> anyhow::Result<Link> {
    email_db_client::links::get::fetch_link_by_id(db, link_id)
        .await
        .map_err(|e| {
            let error_message = "Unable to fetch link from DB for refresh notification";
            tracing::error!(error = ?e, link_id = %link_id, error_message);
            anyhow!(error_message)
        })?
        .ok_or_else(|| {
            let error_message = "Link not found for refresh notification";
            tracing::error!(link_id = %link_id, error_message);
            anyhow!(error_message)
        })
}
