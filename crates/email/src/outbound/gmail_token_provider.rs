use authentication_service_client::AuthServiceClient;
use email_utils::token_cache_key::TokenCacheKey;
use redis::aio::MultiplexedConnection;
use std::sync::Arc;
use tokio::sync::OnceCell;

#[cfg(test)]
mod test;

enum TokenCacheConnection {
    Connected(MultiplexedConnection),
    Lazy {
        client: Box<redis::Client>,
        connection: OnceCell<MultiplexedConnection>,
    },
}

use crate::domain::models::{EmailErr, Link};
use crate::domain::ports::GmailTokenProvider;

/// Adapter implementing [`GmailTokenProvider`] using Redis cache with auth service fallback.
pub struct GmailTokenProviderImpl {
    redis_conn: TokenCacheConnection,
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
            redis_conn: TokenCacheConnection::Connected(redis_conn),
            auth_service_client,
        }
    }

    /// Defer connecting until sender lookup, so Redis downtime cannot prevent a
    /// host from starting. Failed initialization is retried on the next lookup.
    pub fn lazy(client: redis::Client, auth_service_client: Arc<AuthServiceClient>) -> Self {
        Self {
            redis_conn: TokenCacheConnection::Lazy {
                client: Box::new(client),
                connection: OnceCell::new(),
            },
            auth_service_client,
        }
    }

    async fn connection(&self) -> Result<&MultiplexedConnection, EmailErr> {
        match &self.redis_conn {
            TokenCacheConnection::Connected(connection) => Ok(connection),
            TokenCacheConnection::Lazy { client, connection } => {
                connection
                    .get_or_try_init(|| async {
                        client
                            .get_multiplexed_async_connection()
                            .await
                            .map_err(|error| EmailErr::ProviderErr(error.into()))
                    })
                    .await
            }
        }
    }
}

impl GmailTokenProvider for GmailTokenProviderImpl {
    async fn fetch_gmail_access_token(&self, link: &Link) -> Result<String, EmailErr> {
        let key = TokenCacheKey::new(
            &link.fusionauth_user_id,
            link.email_address.0.as_ref(),
            link.provider.as_str(),
        );
        google_token::fetch_gmail_access_token(
            &key,
            self.connection().await?,
            &self.auth_service_client,
        )
        .await
        .map_err(EmailErr::ProviderErr)
    }

    #[tracing::instrument(skip(self, link), err)]
    async fn fetch_gmail_access_token_no_cache(&self, link: &Link) -> Result<String, EmailErr> {
        let key = TokenCacheKey::new(
            &link.fusionauth_user_id,
            link.email_address.0.as_ref(),
            link.provider.as_str(),
        );
        google_token::fetch_gmail_access_token_no_cache(
            &key,
            self.connection().await?,
            &self.auth_service_client,
        )
        .await
        .map_err(EmailErr::ProviderErr)
    }
}
