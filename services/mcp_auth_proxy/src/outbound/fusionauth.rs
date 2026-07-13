//! FusionAuth adapter for the MCP OAuth broker.

use anyhow::Context;
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
    google_idp_id: String,
}

impl FusionAuthOAuthProvider {
    /// Creates a provider and resolves the Google identity provider ID.
    #[tracing::instrument(skip(client), err)]
    pub async fn new(client: fusionauth::FusionAuthClient) -> anyhow::Result<Self> {
        let google_idp_id = client
            .get_identity_provider_id_by_name("google_gmail")
            .await
            .context("failed to look up Google Gmail identity provider in FusionAuth")?;
        tracing::debug!(%google_idp_id, "resolved Google IDP ID from FusionAuth");

        Ok(Self {
            client: Arc::new(client),
            google_idp_id,
        })
    }
}

impl OAuthProvider for FusionAuthOAuthProvider {
    #[tracing::instrument(skip(self), err)]
    fn construct_authorize_url(&self, state: &str) -> anyhow::Result<String> {
        self.client.construct_oauth2_authorize_url(
            &self.google_idp_id,
            None,
            Some(state.to_owned()),
        )
    }

    fn exchange_authorization_code<'a>(&'a self, code: &'a str) -> TokenPairFuture<'a> {
        let span = tracing::debug_span!("FusionAuthOAuthProvider::exchange_authorization_code");
        Box::pin(
            async move {
                let (access_token, refresh_token) = self
                    .client
                    .complete_authorization_code_grant(code)
                    .await
                    .map_err(anyhow::Error::from)?;

                Ok((access_token.into(), refresh_token.into()))
            }
            .instrument(span),
        )
    }

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
