use crate::util::redis::RedisClient;
use anyhow::Context;
use authentication_service_client::AuthServiceClient;
use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use gmail_client::GmailClient;
use model::response::ErrorResponse;
use model::user::UserContext;
use models_email::email::service::cache::TokenCacheKey;
use models_email::email::service::link::Link;
use models_email::email::service::link::UserProvider;
use models_email::gmail::webhook::KeyMap;
use std::sync::Arc;

pub async fn fetch_gmail_token_usercontext_response(
    user_context: &UserContext,
    redis_client: &RedisClient,
    auth_service_client: &AuthServiceClient,
) -> Result<String, Response> {
    // Create the cache key using the extracted email
    let key = TokenCacheKey::new(
        &user_context.fusion_user_id,
        &user_context.user_id,
        UserProvider::Gmail,
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

/// Creates a cache key using a link, then fetches access token
pub async fn fetch_gmail_access_token_from_link(
    link: Link,
    redis_client: &RedisClient,
    auth_service_client: &AuthServiceClient,
) -> anyhow::Result<String> {
    // Create the cache key using the extracted email
    let key = TokenCacheKey::new(&link.fusionauth_user_id, &link.macro_id, link.provider);

    fetch_gmail_access_token(&key, redis_client, auth_service_client).await
}

/// Fetches the gmail access token, first looking in the redis cache then hitting the auth service
pub async fn fetch_gmail_access_token(
    key: &TokenCacheKey,
    redis_client: &RedisClient,
    auth_service_client: &AuthServiceClient,
) -> anyhow::Result<String> {
    let token_from_redis = redis_client
        .get_gmail_access_token(key)
        .await
        .map_err(|e| anyhow::anyhow!("Redis error: {}. TokenCacheKey: {:?}", e, key))
        .ok()
        .flatten();

    let access_token = if let Some(token) = token_from_redis {
        token
    } else {
        let fetched_token = auth_service_client
            .get_google_access_token(&key.fusion_user_id, &key.macro_id)
            .await
            .map_err(|e| {
                anyhow::anyhow!(
                    "Failed to get Google access token from auth service: {}. TokenCacheKey: {:?}",
                    e,
                    key
                )
            })?;

        // Cache newly fetched token
        if let Err(cache_err) = redis_client
            .set_gmail_access_token(key, &fetched_token.access_token)
            .await
        {
            tracing::warn!(
                error = ?cache_err,
                token_cache_key = ?key,
                "Failed to cache fetched access token in Redis"
            );
        }

        fetched_token.access_token
    };

    Ok(access_token)
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
