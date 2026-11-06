//! FusionAuth adapter for the MCP OAuth broker.

#[cfg(test)]
mod test;

use anyhow::Context;
use fusionauth::error::FusionAuthClientError;
use std::sync::Arc;
use tracing::Instrument;
use upstream_error::UpstreamFailure;

use crate::domain::{
    models::{RefreshToken, UpstreamLogin, UpstreamTokens},
    ports::{OAuthProvider, UpstreamGrantError, UpstreamRevocationFuture, UpstreamTokensFuture},
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

/// Sorts a FusionAuth token endpoint failure into the broker's outcomes: a
/// grant FusionAuth refused, an outage, or a fault of ours.
fn grant_error(error: FusionAuthClientError) -> UpstreamGrantError {
    match error {
        FusionAuthClientError::OAuth2TokenRefused(refusal) if refusal.is_invalid_grant() => {
            UpstreamGrantError::InvalidGrant {
                detail: refusal.to_string(),
            }
        }
        FusionAuthClientError::Upstream {
            failure: UpstreamFailure::Unavailable,
            ..
        } => UpstreamGrantError::Unavailable { retry_after: None },
        FusionAuthClientError::Upstream {
            failure: UpstreamFailure::RateLimited { retry_after },
            ..
        } => UpstreamGrantError::Unavailable { retry_after },
        error => UpstreamGrantError::Failed(anyhow::Error::from(error)),
    }
}

impl OAuthProvider for FusionAuthOAuthProvider {
    #[tracing::instrument(skip_all, err)]
    fn construct_authorize_url(
        &self,
        state: &str,
        login: UpstreamLogin<'_>,
    ) -> anyhow::Result<String> {
        match login {
            UpstreamLogin::Google => self.client.construct_oauth2_authorize_url(
                &self.google_idp_id,
                None,
                Some(state.to_owned()),
            ),
            UpstreamLogin::LoginPage => self
                .client
                .construct_oauth2_login_page_url(Some(state.to_owned())),
            UpstreamLogin::Sso { idp_id, email } => self.client.construct_oauth2_authorize_url(
                idp_id,
                Some(email),
                Some(state.to_owned()),
            ),
        }
    }

    fn exchange_authorization_code<'a>(&'a self, code: &'a str) -> UpstreamTokensFuture<'a> {
        let span = tracing::debug_span!("FusionAuthOAuthProvider::exchange_authorization_code");
        Box::pin(
            async move {
                let grant = self
                    .client
                    .complete_authorization_code_grant(code)
                    .await
                    .map_err(grant_error)?;

                Ok(UpstreamTokens {
                    access_token: grant.access_token.into(),
                    refresh_token: grant.refresh_token.into(),
                    expires_in: grant.expires_in,
                })
            }
            .instrument(span),
        )
    }

    fn refresh_access_token<'a>(
        &'a self,
        refresh_token: &'a RefreshToken,
    ) -> UpstreamTokensFuture<'a> {
        let span = tracing::debug_span!("FusionAuthOAuthProvider::refresh_access_token");
        Box::pin(
            async move {
                let grant = self
                    .client
                    .complete_refresh_token_grant(refresh_token.as_str())
                    .await
                    .map_err(grant_error)?;

                Ok(UpstreamTokens {
                    access_token: grant.access_token.into(),
                    refresh_token: grant.refresh_token.into(),
                    expires_in: grant.expires_in,
                })
            }
            .instrument(span),
        )
    }

    fn revoke_refresh_token<'a>(
        &'a self,
        refresh_token: &'a RefreshToken,
    ) -> UpstreamRevocationFuture<'a> {
        let span = tracing::debug_span!("FusionAuthOAuthProvider::revoke_refresh_token");
        Box::pin(
            async move {
                self.client
                    .revoke_refresh_token(refresh_token.as_str())
                    .await
                    .map_err(anyhow::Error::from)
            }
            .instrument(span),
        )
    }
}
