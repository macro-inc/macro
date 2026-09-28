#![deny(missing_docs)]
//! Shared Google/Gmail access-token acquisition against the Redis cache and
//! authentication service, reused by the email and calendar hosts.

use anyhow::Context;
use authentication_service_client::AuthServiceClient;
use email_utils::token_cache_key::TokenCacheKey;
use redis::AsyncCommands;
use redis::aio::MultiplexedConnection;

/// Ten minutes less than the hour the token is valid for, for long-running jobs.
static GMAIL_ACCESS_TOKEN_EXPIRY_SECONDS: u64 = 3000;

/// Fetches a Gmail access token, first checking the Redis cache then falling back to the auth
/// service. Caches newly fetched tokens in Redis.
///
/// [`MultiplexedConnection`] is cheap to clone internally, so passing a reference is fine.
pub async fn fetch_gmail_access_token(
    key: &TokenCacheKey,
    redis_conn: &MultiplexedConnection,
    auth_service_client: &AuthServiceClient,
) -> anyhow::Result<String> {
    // MultiplexedConnection::clone is just an Arc bump
    let mut conn = redis_conn.clone();
    let redis_key = key.to_redis_key();

    let token_from_redis: Option<String> = conn
        .get(&redis_key)
        .await
        .map_err(|e| anyhow::anyhow!("Redis error: {}. TokenCacheKey: {:?}", e, key))
        .ok()
        .flatten();

    let access_token = if let Some(token) = token_from_redis {
        token
    } else {
        let token = fetch_token_from_auth_service(key, auth_service_client).await?;
        cache_token_in_redis(&mut conn, key, &token).await;
        token
    };

    Ok(access_token)
}

/// Fetches a Gmail access token directly from the auth service, bypassing the Redis cache for
/// reads but still caching the newly fetched token.
#[tracing::instrument(skip(key, redis_conn, auth_service_client), err(level = "debug"))]
pub async fn fetch_gmail_access_token_no_cache(
    key: &TokenCacheKey,
    redis_conn: &MultiplexedConnection,
    auth_service_client: &AuthServiceClient,
) -> anyhow::Result<String> {
    let token = fetch_token_from_auth_service(key, auth_service_client).await?;
    let mut conn = redis_conn.clone();
    cache_token_in_redis(&mut conn, key, &token).await;
    Ok(token)
}

/// Best-effort cache write. Logs a warning on failure but never errors.
#[tracing::instrument(skip(conn, key, token))]
async fn cache_token_in_redis(conn: &mut MultiplexedConnection, key: &TokenCacheKey, token: &str) {
    let redis_key = key.to_redis_key();
    if let Err(cache_err) = conn
        .set_ex::<&str, &str, ()>(&redis_key, token, GMAIL_ACCESS_TOKEN_EXPIRY_SECONDS)
        .await
    {
        tracing::warn!(
            error = ?cache_err,
            token_cache_key = ?key,
            "Failed to cache fetched access token in Redis"
        );
    }
}

/// Fetches a Gmail access token from the auth service.
#[tracing::instrument(skip(key, auth_service_client), err(level = "debug"))]
async fn fetch_token_from_auth_service(
    key: &TokenCacheKey,
    auth_service_client: &AuthServiceClient,
) -> anyhow::Result<String> {
    let fetched_token = auth_service_client
        .get_google_access_token(&key.fusion_user_id, &key.email_address)
        .await
        .with_context(|| {
            format!(
                "Failed to get Google access token from auth service. TokenCacheKey: {:?}",
                key
            )
        })?;

    Ok(fetched_token.access_token)
}
