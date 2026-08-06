//! Access-token adapter for user-initiated calendar mutations.

use authentication_service_client::{AuthServiceClient, error::AuthServiceClientError};
use calendar_events::domain::{
    models::CalendarLinkTokenIdentity,
    ports::{CalendarAccessTokenProvider, CalendarTokenError},
};
use email::outbound::fetch_gmail_access_token;
use email_utils::token_cache_key::TokenCacheKey;
use redis::aio::MultiplexedConnection;
use std::sync::Arc;

/// Mints Google access tokens for calendar mutations through the same
/// Redis-cached auth-service path Gmail requests use.
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
        let key = TokenCacheKey::new(
            &identity.fusionauth_user_id,
            &identity.email_address,
            &identity.provider,
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
