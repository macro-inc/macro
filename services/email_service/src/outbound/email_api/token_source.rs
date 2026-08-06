//! Access-token sources backed by email-service infrastructure.

#[cfg(test)]
mod test;

use anyhow::Context;
use authentication_service_client::{AuthServiceClient, error::AuthServiceClientError};
use email_api_client::domain::models::{AccessToken, TokenError, TokenFreshness};
use email_api_client::domain::ports::ProviderTokenSource;
use models_email::email::service::cache::TokenCacheKey;
use models_email::email::service::pubsub::LinkManagerMessage;
use models_email::service::link::Link;
use sqlx::PgPool;
use sqs_client::SQS;
use uuid::Uuid;

use crate::util::redis::RedisClient;

/// Token source that resolves linked mailboxes through the email database and
/// acquires Gmail grants through Redis and the authentication service.
///
/// Successful fetches clear stale reauthorization health. Revoked or missing
/// grants mark the link for reauthorization and enqueue a notification only on
/// the first health transition.
#[derive(Clone)]
pub struct EmailServiceTokenSource {
    db: PgPool,
    redis_client: RedisClient,
    auth_service_client: AuthServiceClient,
    sqs_client: SQS,
}

impl EmailServiceTokenSource {
    /// Creates an email-service token source from its infrastructure clients.
    pub fn new(
        db: PgPool,
        redis_client: RedisClient,
        auth_service_client: AuthServiceClient,
        sqs_client: SQS,
    ) -> Self {
        Self {
            db,
            redis_client,
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
            .ok_or_else(|| transient_error("linked mailbox was not found"))?;

        self.get_access_token_for_link(&link, freshness).await
    }

    async fn get_access_token_for_link(
        &self,
        link: &Link,
        freshness: TokenFreshness,
    ) -> Result<AccessToken, TokenError> {
        let result = self.fetch_token(link, freshness).await;
        let result = self.record_token_health(link, result).await;

        result
            .map(AccessToken::new)
            .map_err(map_token_acquisition_error)
    }
}

impl EmailServiceTokenSource {
    async fn fetch_token(&self, link: &Link, freshness: TokenFreshness) -> anyhow::Result<String> {
        let key = TokenCacheKey::new(
            &link.fusionauth_user_id,
            link.email_address.0.as_ref(),
            link.provider.as_str(),
        );
        let connection = self
            .redis_client
            .inner
            .get_multiplexed_async_connection()
            .await
            .context("unable to connect to redis")?;

        match freshness {
            TokenFreshness::Cached => {
                email::outbound::fetch_gmail_access_token(
                    &key,
                    &connection,
                    &self.auth_service_client,
                )
                .await
            }
            TokenFreshness::Fresh => {
                email::outbound::fetch_gmail_access_token_no_cache(
                    &key,
                    &connection,
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
    ) -> anyhow::Result<String> {
        match result {
            Ok(token) => {
                email_db_client::links::update::clear_link_needs_reauth(&self.db, link.id)
                    .await
                    .inspect_err(|error| {
                        tracing::warn!(error=?error, link_id=%link.id, "Failed to clear needs_reauth after successful token fetch");
                    })
                    .ok();
                Ok(token)
            }
            Err(error) if is_reauth_required_error(&error) => {
                tracing::warn!(
                    link_id=%link.id,
                    fusionauth_user_id=%link.fusionauth_user_id,
                    "Gmail grant no longer yields a token - marking link as needing reauth"
                );
                match email_db_client::links::update::set_link_needs_reauth(&self.db, link.id).await
                {
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
                Err(error)
            }
            Err(error) => Err(error),
        }
    }
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
