//! FusionAuth adapter for the MCP OAuth broker.

use std::sync::Arc;
use tracing::Instrument;

use crate::domain::{
    models::RefreshToken,
    ports::{OAuthProvider, TokenPairFuture},
};

/// FusionAuth-backed OAuth provider for the MCP auth proxy.
#[derive(Clone)]
pub struct FusionAuthOAuthProvider {
    client: Arc<fusionauth::FusionAuthClient>,
}

impl FusionAuthOAuthProvider {
    /// Creates a provider around an existing FusionAuth client.
    pub fn new(client: fusionauth::FusionAuthClient) -> Self {
        Self {
            client: Arc::new(client),
        }
    }
}

impl OAuthProvider for FusionAuthOAuthProvider {
    fn refresh_access_token<'a>(&'a self, refresh_token: &'a RefreshToken) -> TokenPairFuture<'a> {
        let span = tracing::debug_span!("FusionAuthOAuthProvider::refresh_access_token");
        Box::pin(
            async move {
                let (access_token, refresh_token) = self
                    .client
                    .complete_refresh_token_grant(refresh_token.as_str())
                    .await
                    .map_err(anyhow::Error::from)?;

                Ok((access_token.into(), refresh_token.into()))
            }
            .instrument(span),
        )
    }
}
