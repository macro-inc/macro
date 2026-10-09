//! Access-token adapter for user-initiated calendar mutations.

use authentication_service_client::{AuthServiceClient, error::AuthServiceClientError};
use calendar_events::domain::{
    models::{CalendarLinkTokenIdentity, CalendarProvider},
    ports::{CalendarAccessTokenProvider, CalendarTokenError},
};
use email_utils::token_cache_key::TokenCacheKey;
use google_token::fetch_gmail_access_token;
use redis::aio::MultiplexedConnection;
use std::sync::Arc;

/// Acquires provider credentials through the owning authentication service.
#[derive(Clone)]
pub struct CalendarTokenProviderAdapter {
    redis_conn: MultiplexedConnection,
    auth_service_client: Arc<AuthServiceClient>,
}

impl CalendarTokenProviderAdapter {
    /// Construct the adapter from the shared Redis connection and auth client.
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

impl CalendarAccessTokenProvider for CalendarTokenProviderAdapter {
    async fn fetch_access_token(
        &self,
        identity: &CalendarLinkTokenIdentity,
    ) -> Result<String, CalendarTokenError> {
        if identity.provider == CalendarProvider::Outlook {
            let binding = identity.binding.ok_or_else(|| {
                CalendarTokenError::ReauthRequired("Microsoft calendar binding is missing".into())
            })?;
            let token = self
                .auth_service_client
                .get_microsoft_access_token(
                    binding.link_id,
                    binding.grant_generation,
                    binding.sync_generation,
                    false,
                )
                .await
                .map_err(|error| match error {
                    AuthServiceClientError::Forbidden
                    | AuthServiceClientError::NotFound
                    | AuthServiceClientError::Unauthorized => {
                        CalendarTokenError::ReauthRequired("Reconnect Microsoft calendar".into())
                    }
                    _ => CalendarTokenError::Transient(
                        "Microsoft calendar credentials are temporarily unavailable".into(),
                    ),
                })?;
            if !token
                .scopes
                .iter()
                .any(|scope| scope.eq_ignore_ascii_case("Calendars.ReadWrite"))
            {
                return Err(CalendarTokenError::ReauthRequired(
                    "Microsoft calendar permission is required".into(),
                ));
            }
            return Ok(token.access_token);
        }
        let key = TokenCacheKey::new(
            &identity.fusionauth_user_id,
            &identity.email_address,
            identity.provider.link_provider(),
        );
        fetch_gmail_access_token(&key, &self.redis_conn, &self.auth_service_client)
            .await
            .map_err(|error| {
                let reauth = error.chain().any(|cause| {
                    cause
                        .downcast_ref::<AuthServiceClientError>()
                        .is_some_and(|cause| {
                            matches!(
                                cause,
                                AuthServiceClientError::Forbidden
                                    | AuthServiceClientError::NotFound
                            )
                        })
                });
                if reauth {
                    CalendarTokenError::ReauthRequired(format!("{error:?}"))
                } else {
                    CalendarTokenError::Transient(format!("{error:?}"))
                }
            })
    }
}

impl email_api_client::domain::ports::MailboxRejectedTokenRefresh for CalendarTokenProviderAdapter {
    fn refresh(
        &self,
        mailbox: email_api_client::domain::models::MailboxAccess,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<
                    Output = Result<
                        email_api_client::domain::models::AccessToken,
                        email_api_client::domain::models::EmailApiError,
                    >,
                > + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            use email_api_client::domain::models::{AccessToken, EmailApiError};
            let token = self
                .auth_service_client
                .get_microsoft_access_token(
                    mailbox.link_id,
                    mailbox.grant_generation,
                    mailbox.sync_generation,
                    true,
                )
                .await
                .map_err(|error| match error {
                    AuthServiceClientError::Unauthorized
                    | AuthServiceClientError::Forbidden
                    | AuthServiceClientError::NotFound => EmailApiError::AuthRequired,
                    _ => EmailApiError::Transient {
                        message: "Microsoft calendar credentials are temporarily unavailable"
                            .into(),
                    },
                })?;
            if !token.scopes.iter().any(|s| {
                s.rsplit('/')
                    .next()
                    .is_some_and(|s| s.eq_ignore_ascii_case("Calendars.ReadWrite"))
            }) {
                return Err(EmailApiError::AuthRequired);
            }
            Ok(AccessToken::new(token.access_token))
        })
    }
}
