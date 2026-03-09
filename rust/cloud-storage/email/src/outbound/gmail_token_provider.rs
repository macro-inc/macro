use anyhow::Context;
use authentication_service_client::AuthServiceClient;
use email_utils::token_cache_key::TokenCacheKey;
use redis::AsyncCommands;
use redis::aio::MultiplexedConnection;
use std::sync::Arc;

use crate::domain::models::{EmailErr, Link};
use crate::inbound::GmailTokenProvider;

/// Ten minutes less than the hour the token is valid for, for long-running jobs.
static GMAIL_ACCESS_TOKEN_EXPIRY_SECONDS: u64 = 3000;

/// Adapter implementing [`GmailTokenProvider`] using Redis cache with auth service fallback.
pub struct GmailTokenProviderImpl {
    redis_conn: MultiplexedConnection,
    auth_service_client: Arc<AuthServiceClient>,
}

impl GmailTokenProviderImpl {
    /// Create a new provider with the given Redis connection and auth service client.
    ///
    /// The [`MultiplexedConnection`] is cheap to clone and designed to be shared.
    pub fn new(
        redis_conn: MultiplexedConnection,
        auth_service_client: Arc<AuthServiceClient>,
    ) -> Self {
        Self {
            redis_conn,
            auth_service_client,
        }
    }
}

impl GmailTokenProvider for GmailTokenProviderImpl {
    async fn fetch_gmail_access_token(&self, link: &Link) -> Result<String, EmailErr> {
        let key = TokenCacheKey::new(
            &link.fusionauth_user_id,
            link.macro_id.0.as_ref(),
            link.provider.as_str(),
        );
        fetch_gmail_access_token(&key, &self.redis_conn, &self.auth_service_client)
            .await
            .map_err(EmailErr::ProviderErr)
    }
}

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
        let fetched_token = auth_service_client
            .get_google_access_token(&key.fusion_user_id, &key.macro_id)
            .await
            .with_context(|| {
                format!(
                    "Failed to get Google access token from auth service. TokenCacheKey: {:?}",
                    key
                )
            })?;

        // Cache newly fetched token
        if let Err(cache_err) = conn
            .set_ex::<&str, &str, ()>(
                &redis_key,
                &fetched_token.access_token,
                GMAIL_ACCESS_TOKEN_EXPIRY_SECONDS,
            )
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
