use crate::util::redis::RedisClient;
use anyhow::Context;
use authentication_service_client::{AuthServiceClient, error::AuthServiceClientError};
use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use gmail_client::GmailClient;
use model::response::ErrorResponse;
use model::user::UserContext;
use models_email::email::service::cache::TokenCacheKey;
use models_email::email::service::link::Link;
use models_email::email::service::link::UserProvider;
use models_email::email::service::pubsub::{LinkManagerMessage, LinkManagerOperation};
use models_email::gmail::inbox_sync::KeyMap;
use sqs_client::SQS;
use std::sync::Arc;

/// Fetches Gmail access token from link and triggers link deletion if access was revoked.
/// This should be used by pubsub handlers where we want to automatically clean up revoked links.
/// API handlers should use `fetch_gmail_access_token_from_link` directly instead.
#[tracing::instrument(skip(redis_client, auth_service_client, sqs_client))]
pub async fn fetch_token_or_delete_on_revocation(
    link: &Link,
    redis_client: &RedisClient,
    auth_service_client: &AuthServiceClient,
    sqs_client: &SQS,
) -> anyhow::Result<String> {
    match fetch_gmail_access_token_from_link(link, redis_client, auth_service_client).await {
        Ok(token) => Ok(token),
        Err(e) if is_forbidden_error(&e) => {
            tracing::warn!(
                link_id = %link.id,
                fusionauth_user_id = %link.fusionauth_user_id,
                "User revoked access to Gmail - enqueueing link deletion"
            );

            sqs_client
                .enqueue_link_manager_notification(LinkManagerMessage {
                    link_id: link.id,
                    operation: LinkManagerOperation::Delete,
                })
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, link_id=%link.id, "Failed to enqueue link deletion after detecting revoked access");
                })
                .ok();

            Err(e)
        }
        Err(e) => Err(e),
    }
}

/// Checks if an error chain contains a Forbidden error from the auth service
fn is_forbidden_error(e: &anyhow::Error) -> bool {
    e.chain().any(|cause| {
        cause
            .downcast_ref::<AuthServiceClientError>()
            .map(|e| matches!(e, AuthServiceClientError::Forbidden))
            .unwrap_or(false)
    })
}

/// Creates a cache key using a link, then fetches access token. Returns error if access token can't
/// be fetched.
pub async fn fetch_gmail_access_token_from_link(
    link: &Link,
    redis_client: &RedisClient,
    auth_service_client: &AuthServiceClient,
) -> anyhow::Result<String> {
    // Create the cache key using the extracted email
    let key = TokenCacheKey::new(
        &link.fusionauth_user_id,
        link.macro_id.0.as_ref(),
        link.provider.as_str(),
    );

    fetch_gmail_access_token(&key, redis_client, auth_service_client).await
}

/// fetches a user's gmail token using the user_context from the API request
pub async fn fetch_gmail_token_usercontext_response(
    user_context: &UserContext,
    redis_client: &RedisClient,
    auth_service_client: &AuthServiceClient,
) -> Result<String, Response> {
    // Create the cache key using the extracted email
    let key = TokenCacheKey::new(
        &user_context.fusion_user_id,
        &user_context.user_id,
        UserProvider::Gmail.as_str(),
    );

    fetch_gmail_access_token(&key, redis_client, auth_service_client)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to get gmail access token");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to get gmail access token",
                }),
            )
                .into_response()
        })
}

/// Fetches a user's gmail token directly from the auth service, bypassing the Redis cache.
/// Used by the init endpoint where we always want a fresh token.
#[tracing::instrument(skip(user_context, redis_client, auth_service_client))]
pub async fn fetch_gmail_token_no_cache(
    user_context: &UserContext,
    redis_client: &RedisClient,
    auth_service_client: &AuthServiceClient,
) -> Result<String, Response> {
    let key = TokenCacheKey::new(
        &user_context.fusion_user_id,
        &user_context.user_id,
        UserProvider::Gmail.as_str(),
    );

    let conn = redis_client
        .inner
        .get_multiplexed_async_connection()
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to connect to redis");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to get gmail access token",
                }),
            )
                .into_response()
        })?;

    email::outbound::fetch_gmail_access_token_no_cache(&key, &conn, auth_service_client)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to get gmail access token from auth service");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to get gmail access token",
                }),
            )
                .into_response()
        })
}

/// Fetches the gmail access token, first looking in the redis cache then hitting the auth service.
///
/// Delegates to [`email::outbound::fetch_gmail_access_token`].
pub async fn fetch_gmail_access_token(
    key: &TokenCacheKey,
    redis_client: &RedisClient,
    auth_service_client: &AuthServiceClient,
) -> anyhow::Result<String> {
    let conn = redis_client
        .inner
        .get_multiplexed_async_connection()
        .await
        .context("unable to connect to redis")?;
    email::outbound::fetch_gmail_access_token(key, &conn, auth_service_client).await
}

/// Retrieves Google public keys, first looking in the redis cache then fetching them from the Gmail client
#[tracing::instrument(skip(redis_client, gmail_client))]
pub async fn get_google_public_keys(
    redis_client: Arc<RedisClient>,
    gmail_client: Arc<GmailClient>,
) -> anyhow::Result<KeyMap> {
    // Try to get the keys from Redis cache first
    let keys_from_redis = redis_client
        .get_google_public_keys()
        .await
        .map_err(|e| {
            tracing::warn!(error=?e, "Failed to get Google public keys from Redis, falling back.");
        })
        .ok()
        .flatten();

    let public_keys = if let Some(keys) = keys_from_redis {
        keys
    } else {
        fetch_and_cache_google_public_keys(redis_client, gmail_client).await?
    };

    Ok(public_keys)
}

/// Fetches Google public keys from Gmail client and caches them in Redis
#[tracing::instrument(skip(redis_client, gmail_client))]
pub async fn fetch_and_cache_google_public_keys(
    redis_client: Arc<RedisClient>,
    gmail_client: Arc<GmailClient>,
) -> anyhow::Result<KeyMap> {
    let fetched_keys = gmail_client
        .get_google_public_keys()
        .await
        .context("Failed to fetch Google public keys")?;

    if let Err(cache_err) = redis_client.set_google_public_keys(&fetched_keys).await {
        tracing::warn!(error = ?cache_err, "Failed to cache Google public keys in Redis");
    }

    Ok(fetched_keys.keys)
}
