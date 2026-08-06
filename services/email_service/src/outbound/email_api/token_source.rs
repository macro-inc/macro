//! Access-token sources backed by email-service infrastructure.

#[cfg(test)]
mod test;

use authentication_service_client::AuthServiceClient;
use email_api_client::domain::models::{AccessToken, TokenError, TokenFreshness};
use email_api_client::domain::ports::ProviderTokenSource;
use models_email::service::link::Link;
use sqlx::PgPool;
use sqs_client::SQS;
use uuid::Uuid;

use crate::util::gmail::auth::{
    fetch_token_or_mark_reauth, fetch_token_or_mark_reauth_no_cache, is_reauth_required_error,
};
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
        let result = match freshness {
            TokenFreshness::Cached => {
                fetch_token_or_mark_reauth(
                    link,
                    &self.db,
                    &self.redis_client,
                    &self.auth_service_client,
                    &self.sqs_client,
                )
                .await
            }
            TokenFreshness::Fresh => {
                fetch_token_or_mark_reauth_no_cache(
                    link,
                    &self.db,
                    &self.redis_client,
                    &self.auth_service_client,
                    &self.sqs_client,
                )
                .await
            }
        };

        result
            .map(AccessToken::new)
            .map_err(map_token_acquisition_error)
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

fn transient_error(message: impl Into<String>) -> TokenError {
    TokenError::Transient {
        message: message.into(),
    }
}
