use crate::util::redis::RedisClient;
use anyhow::Context;
use authentication_service_client::{AuthServiceClient, error::AuthServiceClientError};
use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use gmail_client::GmailClient;
use macro_user_id::user_id::MacroUserIdStr;
use model::response::ErrorResponse;
use model::user::UserContext;
use models_email::email::service::cache::TokenCacheKey;
use models_email::email::service::link::Link;
use models_email::email::service::link::UserProvider;
use models_email::email::service::pubsub::LinkManagerMessage;
use models_email::gmail::inbox_sync::KeyMap;
use sqs_client::SQS;
use std::sync::Arc;

/// Fetches a Gmail access token for a link and records its sync health as a side
/// effect: clears the link's reauth flag on success, and on a revoked or missing
/// grant marks the link as needing reauth (and enqueues a one-time fan-out
/// notification on the first such transition). Other, transient failures are
/// returned unchanged without touching health state.
///
/// Pubsub handlers should use this so a dead grant surfaces for reconnect instead
/// of stalling silently. API handlers should use `fetch_gmail_access_token_from_link`.
#[tracing::instrument(skip(db, redis_client, auth_service_client, sqs_client))]
pub async fn fetch_token_or_mark_reauth(
    link: &Link,
    db: &sqlx::PgPool,
    redis_client: &RedisClient,
    auth_service_client: &AuthServiceClient,
    sqs_client: &SQS,
) -> anyhow::Result<String> {
    let result = fetch_gmail_access_token_from_link(link, redis_client, auth_service_client).await;
    record_token_health(link, db, sqs_client, result).await
}

/// Like [`fetch_token_or_mark_reauth`] but bypasses the Redis token cache and forces a
/// fresh refresh against the auth service. A cached access token outlives a grant
/// revocation by up to its TTL — revocation invalidates the refresh token, not an
/// already-minted access token — so a cache-respecting fetch can miss a just-revoked
/// grant. Probes that must observe revocation promptly use this path.
#[tracing::instrument(skip(db, redis_client, auth_service_client, sqs_client))]
pub async fn fetch_token_or_mark_reauth_no_cache(
    link: &Link,
    db: &sqlx::PgPool,
    redis_client: &RedisClient,
    auth_service_client: &AuthServiceClient,
    sqs_client: &SQS,
) -> anyhow::Result<String> {
    let result =
        fetch_gmail_access_token_from_link_no_cache(link, redis_client, auth_service_client).await;
    record_token_health(link, db, sqs_client, result).await
}

/// Records a link's sync health from the outcome of a token fetch: clears the reauth
/// flag on success, marks the link as needing reauth on a revoked or missing grant
/// (enqueuing a one-time fan-out only on the first false->true transition), and leaves
/// health state untouched for transient failures. Returns the fetch result unchanged.
async fn record_token_health(
    link: &Link,
    db: &sqlx::PgPool,
    sqs_client: &SQS,
    result: anyhow::Result<String>,
) -> anyhow::Result<String> {
    match result {
        Ok(token) => {
            email_db_client::links::update::clear_link_needs_reauth(db, link.id)
                .await
                .inspect_err(|e| {
                    tracing::warn!(error=?e, link_id=%link.id, "Failed to clear needs_reauth after successful token fetch");
                })
                .ok();
            Ok(token)
        }
        Err(e) if is_reauth_required_error(&e) => {
            tracing::warn!(
                link_id = %link.id,
                fusionauth_user_id = %link.fusionauth_user_id,
                "Gmail grant no longer yields a token - marking link as needing reauth"
            );

            match email_db_client::links::update::set_link_needs_reauth(db, link.id).await {
                // Only the transition into needs-reauth fans out a notification, so a
                // link that keeps failing every cycle notifies its sharers just once.
                Ok(true) => {
                    sqs_client
                        .enqueue_link_manager_notification(
                            LinkManagerMessage::NotifyReauthRequired { link_id: link.id },
                        )
                        .await
                        .inspect_err(|e| {
                            tracing::error!(error=?e, link_id=%link.id, "Failed to enqueue reauth notification");
                        })
                        .ok();
                }
                Ok(false) => {}
                Err(e) => {
                    tracing::error!(error=?e, link_id=%link.id, "Failed to mark link as needing reauth");
                }
            }

            Err(e)
        }
        Err(e) => Err(e),
    }
}

/// Checks if an error chain contains a Forbidden error from the auth service.
pub(crate) fn is_forbidden_error(e: &anyhow::Error) -> bool {
    e.chain().any(|cause| {
        cause
            .downcast_ref::<AuthServiceClientError>()
            .map(|e| matches!(e, AuthServiceClientError::Forbidden))
            .unwrap_or(false)
    })
}

/// Whether a token-fetch error means the link's grant is gone (revoked, or the
/// underlying IdP link is missing) and the user must reconnect — as opposed to a
/// transient failure that should be retried without flagging the link.
pub fn is_reauth_required_error(e: &anyhow::Error) -> bool {
    e.chain().any(|cause| {
        cause
            .downcast_ref::<AuthServiceClientError>()
            .map(|e| {
                matches!(
                    e,
                    AuthServiceClientError::Forbidden | AuthServiceClientError::NotFound
                )
            })
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
    let key = TokenCacheKey::new(
        &link.fusionauth_user_id,
        link.email_address.0.as_ref(),
        link.provider.as_str(),
    );

    fetch_gmail_access_token(&key, redis_client, auth_service_client).await
}

/// Like [`fetch_gmail_access_token_from_link`] but bypasses the Redis cache and forces a
/// fresh token from the auth service.
pub async fn fetch_gmail_access_token_from_link_no_cache(
    link: &Link,
    redis_client: &RedisClient,
    auth_service_client: &AuthServiceClient,
) -> anyhow::Result<String> {
    let key = TokenCacheKey::new(
        &link.fusionauth_user_id,
        link.email_address.0.as_ref(),
        link.provider.as_str(),
    );

    let conn = redis_client
        .inner
        .get_multiplexed_async_connection()
        .await
        .context("unable to connect to redis")?;
    email::outbound::fetch_gmail_access_token_no_cache(&key, &conn, auth_service_client).await
}

/// fetches a user's gmail token using the user_context from the API request.
/// This always resolves to the JWT subject's *primary* inbox — the email part of
/// `user_context.user_id`. For multi-inbox callers that need a specific linked
/// inbox's token, build a `TokenCacheKey` from that link's `email_address`
/// directly or use `fetch_gmail_access_token_from_link`.
pub async fn fetch_gmail_token_usercontext_response(
    user_context: &UserContext,
    redis_client: &RedisClient,
    auth_service_client: &AuthServiceClient,
) -> Result<String, Response> {
    let key = TokenCacheKey::new(
        &user_context.fusion_user_id,
        MacroUserIdStr::parse_from_str(&user_context.user_id)
            .map(|id| id.email_str().to_string())
            .map_err(|e| {
                tracing::error!(error=?e, user_id=%user_context.user_id, "unable to derive email from user id");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to get gmail access token".into(),
                    }),
                )
                    .into_response()
            })?,
        UserProvider::Gmail.as_str(),
    );

    fetch_gmail_access_token(&key, redis_client, auth_service_client)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to get gmail access token");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to get gmail access token".into(),
                }),
            )
                .into_response()
        })
}

/// Fetches a user's gmail token directly from the auth service, bypassing the Redis cache.
/// Used by the init endpoint where we always want a fresh token. Resolves to the JWT
/// subject's primary inbox.
#[tracing::instrument(skip(user_context, redis_client, auth_service_client))]
pub async fn fetch_gmail_token_no_cache(
    user_context: &UserContext,
    redis_client: &RedisClient,
    auth_service_client: &AuthServiceClient,
) -> Result<String, Response> {
    let key = TokenCacheKey::new(
        &user_context.fusion_user_id,
        MacroUserIdStr::parse_from_str(&user_context.user_id)
            .map(|id| id.email_str().to_string())
            .map_err(|e| {
                tracing::error!(error=?e, user_id=%user_context.user_id, "unable to derive email from user id");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to get gmail access token".into(),
                    }),
                )
                    .into_response()
            })?,
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
                    message: "unable to get gmail access token".into(),
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
                    message: "unable to get gmail access token".into(),
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
