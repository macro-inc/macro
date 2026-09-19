use crate::util::redis::RedisClient;
use anyhow::Context;
use gmail_client::GmailClient;
use models_email::gmail::inbox_sync::KeyMap;
use std::sync::Arc;

/// Retrieves Google public keys, first looking in the Redis cache and then fetching them.
#[tracing::instrument(skip(redis_client, gmail_client))]
pub async fn get_google_public_keys(
    redis_client: Arc<RedisClient>,
    gmail_client: Arc<GmailClient>,
) -> anyhow::Result<KeyMap> {
    let cached_keys = redis_client
        .get_google_public_keys()
        .await
        .inspect_err(|error| {
            tracing::warn!(error=?error, "Failed to get Google public keys from Redis, falling back");
        })
        .ok()
        .flatten();

    match cached_keys {
        Some(keys) => Ok(keys),
        None => fetch_and_cache_google_public_keys(redis_client, gmail_client).await,
    }
}

/// Fetches Google public keys from Gmail and caches them in Redis.
#[tracing::instrument(skip(redis_client, gmail_client))]
pub async fn fetch_and_cache_google_public_keys(
    redis_client: Arc<RedisClient>,
    gmail_client: Arc<GmailClient>,
) -> anyhow::Result<KeyMap> {
    let fetched_keys = gmail_client
        .get_google_public_keys()
        .await
        .context("Failed to fetch Google public keys")?;

    if let Err(cache_error) = redis_client.set_google_public_keys(&fetched_keys).await {
        tracing::warn!(error=?cache_error, "Failed to cache Google public keys in Redis");
    }

    Ok(fetched_keys.keys)
}
