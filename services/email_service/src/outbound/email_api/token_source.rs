//! Access-token sources backed by email-service infrastructure.

#[cfg(test)]
mod test;

use authentication_service_client::{AuthServiceClient, error::AuthServiceClientError};
use email_api_client::domain::models::{AccessToken, TokenError, TokenFreshness};
use email_api_client::domain::ports::ProviderTokenSource;
use models_email::email::service::cache::TokenCacheKey;
use models_email::email::service::pubsub::LinkManagerMessage;
use models_email::service::link::Link;
use redis::aio::MultiplexedConnection;
use sqlx::PgPool;
use sqs_client::SQS;
use uuid::Uuid;

/// Token source that resolves linked mailboxes through the email database and
/// acquires Gmail grants through Redis and the authentication service.
///
/// Successful fetches clear stale reauthorization health. Revoked or missing
/// grants mark the link for reauthorization and enqueue a notification only on
/// the first health transition.
#[derive(Clone)]
pub struct EmailServiceTokenSource {
    db: PgPool,
    redis_conn: MultiplexedConnection,
    auth_service_client: AuthServiceClient,
    sqs_client: SQS,
}

impl EmailServiceTokenSource {
    /// Creates an email-service token source from its infrastructure clients.
    ///
    /// The [`MultiplexedConnection`] is cheap to clone and designed to be
    /// shared, so token acquisition never dials a new Redis TCP connection
    /// per provider call.
    pub fn new(
        db: PgPool,
        redis_conn: MultiplexedConnection,
        auth_service_client: AuthServiceClient,
        sqs_client: SQS,
    ) -> Self {
        Self {
            db,
            redis_conn,
            auth_service_client,
            sqs_client,
        }
    }
}

impl ProviderTokenSource for EmailServiceTokenSource {
    #[tracing::instrument(skip(self), err)]
    async fn get_access_token(
        &self,
        link_id: Uuid,
        freshness: TokenFreshness,
    ) -> Result<AccessToken, TokenError> {
        let link = email_db_client::links::get::fetch_link_by_id(&self.db, link_id)
            .await
            .inspect_err(|error| {
                tracing::warn!(error=?error, %link_id, "Failed to load link for access-token acquisition");
            })
            .map_err(|_| transient_error("unable to load the linked mailbox"))?
            // A missing link is a deleted mailbox, not an infrastructure blip:
            // retrying would only redeliver the message until the DLQ.
            .ok_or_else(|| TokenError::Permanent {
                message: "linked mailbox was not found".to_string(),
            })?;

        // The row was just read, so the health-clear UPDATE can be gated on
        // its needs_reauth value instead of running unconditionally per call.
        self.acquire(&link, freshness, link.needs_reauth).await
    }

    async fn get_access_token_for_link(
        &self,
        link: &Link,
        freshness: TokenFreshness,
    ) -> Result<AccessToken, TokenError> {
        // Caller-supplied Link values cannot gate the health clear: callers
        // like attach_link_context hardcode needs_reauth: false, which would
        // wrongly skip the UPDATE. Always attempt the clear on this path.
        self.acquire(link, freshness, true).await
    }

    async fn get_access_token_health_neutral(
        &self,
        link: &Link,
        freshness: TokenFreshness,
    ) -> Result<AccessToken, TokenError> {
        // Deliberately bypasses record_token_health: teardown must neither
        // set needs_reauth nor enqueue a reauth notification.
        self.fetch_token(link, freshness)
            .await
            .map(AccessToken::new)
            .map_err(map_token_acquisition_error)
    }
}

impl EmailServiceTokenSource {
    async fn acquire(
        &self,
        link: &Link,
        freshness: TokenFreshness,
        row_may_need_reauth: bool,
    ) -> Result<AccessToken, TokenError> {
        let result = self.fetch_token(link, freshness).await;
        let result = self
            .record_token_health(link, result, row_may_need_reauth)
            .await;

        result
            .map(AccessToken::new)
            .map_err(map_token_acquisition_error)
    }

    async fn fetch_token(&self, link: &Link, freshness: TokenFreshness) -> anyhow::Result<String> {
        let key = TokenCacheKey::new(
            &link.fusionauth_user_id,
            link.email_address.0.as_ref(),
            link.provider.as_str(),
        );

        match freshness {
            TokenFreshness::Cached => {
                email::outbound::fetch_gmail_access_token(
                    &key,
                    &self.redis_conn,
                    &self.auth_service_client,
                )
                .await
            }
            TokenFreshness::Fresh => {
                email::outbound::fetch_gmail_access_token_no_cache(
                    &key,
                    &self.redis_conn,
                    &self.auth_service_client,
                )
                .await
            }
        }
    }

    async fn record_token_health(
        &self,
        link: &Link,
        result: anyhow::Result<String>,
        row_may_need_reauth: bool,
    ) -> anyhow::Result<String> {
        match token_health_action(&result, row_may_need_reauth) {
            TokenHealthAction::None => result,
            TokenHealthAction::ClearReauth => {
                clear_stale_reauth_flag(&self.db, link.id).await;
                result
            }
            TokenHealthAction::MarkReauth => {
                tracing::warn!(
                    link_id=%link.id,
                    fusionauth_user_id=%link.fusionauth_user_id,
                    "Gmail grant no longer yields a token - marking link as needing reauth"
                );
                match email_db_client::links::update::set_link_needs_reauth(&self.db, link.id).await
                {
                    // Edge-triggered: the notification fans out only on the
                    // false→true transition, so repeat failures don't re-notify.
                    Ok(true) => {
                        self.sqs_client
                            .enqueue_link_manager_notification(
                                LinkManagerMessage::NotifyReauthRequired { link_id: link.id },
                            )
                            .await
                            .inspect_err(|enqueue_error| {
                                tracing::error!(error=?enqueue_error, link_id=%link.id, "Failed to enqueue reauth notification");
                            })
                            .ok();
                    }
                    Ok(false) => {}
                    Err(update_error) => {
                        tracing::error!(error=?update_error, link_id=%link.id, "Failed to mark link as needing reauth");
                    }
                }
                result
            }
        }
    }
}

/// The health side effect implied by a token acquisition outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TokenHealthAction {
    /// No health write: transient failures leave health untouched, and a
    /// success against a known-healthy row skips the redundant UPDATE.
    None,
    /// Clear a possibly-set `needs_reauth` flag after a successful fetch.
    ClearReauth,
    /// Mark the link as needing reauthorization (revoked/missing grant).
    MarkReauth,
}

fn token_health_action(
    result: &anyhow::Result<String>,
    row_may_need_reauth: bool,
) -> TokenHealthAction {
    match result {
        Ok(_) if row_may_need_reauth => TokenHealthAction::ClearReauth,
        Ok(_) => TokenHealthAction::None,
        Err(error) if is_reauth_required_error(error) => TokenHealthAction::MarkReauth,
        Err(_) => TokenHealthAction::None,
    }
}

/// Clears the link's reauth flag after a successful token fetch.
///
/// A failed clear is logged and swallowed: the next acquisition retries it.
async fn clear_stale_reauth_flag(db: &PgPool, link_id: Uuid) {
    email_db_client::links::update::clear_link_needs_reauth(db, link_id)
        .await
        .inspect_err(|error| {
            tracing::warn!(error=?error, %link_id, "Failed to clear needs_reauth after successful token fetch");
        })
        .ok();
}

/// Token source that returns one preconfigured access token.
///
/// This is intended for command-line jobs that acquire a token before composing
/// the provider service and do not need email-service token health side effects.
#[derive(Clone, Debug)]
pub struct StaticTokenSource {
    token: AccessToken,
}

impl StaticTokenSource {
    /// Creates a static token source.
    pub fn new(token: impl Into<String>) -> Self {
        Self {
            token: AccessToken::new(token),
        }
    }
}

impl ProviderTokenSource for StaticTokenSource {
    async fn get_access_token(
        &self,
        _link_id: Uuid,
        _freshness: TokenFreshness,
    ) -> Result<AccessToken, TokenError> {
        Ok(self.token.clone())
    }

    async fn get_access_token_for_link(
        &self,
        _link: &Link,
        _freshness: TokenFreshness,
    ) -> Result<AccessToken, TokenError> {
        Ok(self.token.clone())
    }

    async fn get_access_token_health_neutral(
        &self,
        _link: &Link,
        _freshness: TokenFreshness,
    ) -> Result<AccessToken, TokenError> {
        Ok(self.token.clone())
    }
}

fn map_token_acquisition_error(error: anyhow::Error) -> TokenError {
    if is_reauth_required_error(&error) {
        return TokenError::ReauthRequired;
    }

    tracing::warn!(error=?error, "Transient access-token acquisition failure");
    transient_error("email provider access token is temporarily unavailable")
}

fn is_reauth_required_error(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        cause
            .downcast_ref::<AuthServiceClientError>()
            .is_some_and(|error| {
                matches!(
                    error,
                    AuthServiceClientError::Forbidden | AuthServiceClientError::NotFound
                )
            })
    })
}

fn transient_error(message: impl Into<String>) -> TokenError {
    TokenError::Transient {
        message: message.into(),
    }
}
