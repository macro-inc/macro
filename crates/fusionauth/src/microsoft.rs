use std::fmt;

use crate::{
    FusionAuthClient, Result,
    error::{FusionAuthClientError, GenericErrorResponse},
};

/// Microsoft OAuth token and ID-token operations.
pub mod oauth;

#[cfg(test)]
mod test;

#[derive(Clone)]
pub(crate) struct MicrosoftOAuthCredentials {
    client_id: String,
    client_secret: String,
    tenant_id: String,
}

impl fmt::Debug for MicrosoftOAuthCredentials {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MicrosoftOAuthCredentials")
            .field("client_id", &self.client_id)
            .field("client_secret", &"[REDACTED]")
            .field("tenant_id", &self.tenant_id)
            .finish()
    }
}

impl FusionAuthClient {
    /// Configures the Microsoft OAuth application used for secondary account linking.
    pub fn with_microsoft_credentials(
        mut self,
        client_id: String,
        client_secret: String,
        tenant_id: String,
    ) -> Self {
        self.microsoft_credentials = Some(MicrosoftOAuthCredentials {
            client_id,
            client_secret,
            tenant_id,
        });
        self
    }

    /// Constructs a tenant-specific Microsoft OAuth authorization URL.
    pub fn construct_microsoft_authorize_url<T>(
        &self,
        redirect_uri: &str,
        state: &T,
    ) -> Result<String>
    where
        T: serde::Serialize + ?Sized,
    {
        let credentials = self.microsoft_credentials()?;
        oauth::construct_authorize_url(
            &credentials.client_id,
            &credentials.tenant_id,
            redirect_uri,
            state,
        )
        .map_err(FusionAuthClientError::from)
    }

    /// Exchanges a Microsoft authorization code for a refresh token and ID token.
    #[tracing::instrument(skip(self, code, redirect_uri), err)]
    pub async fn exchange_microsoft_code_for_tokens(
        &self,
        code: &str,
        redirect_uri: &str,
    ) -> Result<oauth::MicrosoftExchangeTokenResponse> {
        let credentials = self.microsoft_credentials()?;
        oauth::exchange_code_for_tokens(
            &self.unauth_client,
            &credentials.client_id,
            &credentials.client_secret,
            &credentials.tenant_id,
            redirect_uri,
            code,
        )
        .await
    }

    /// Verifies a Microsoft ID token against the tenant's OIDC signing keys and extracts the
    /// identity claims. The signature, issuer, audience, tenant, expiration, and not-before
    /// claims are all validated before any claim is trusted.
    #[tracing::instrument(skip(self, id_token), err)]
    pub async fn parse_microsoft_id_token(
        &self,
        id_token: &str,
    ) -> Result<oauth::MicrosoftUserInfo> {
        let credentials = self.microsoft_credentials()?;
        let signing_keys = oauth::fetch_microsoft_signing_keys(
            &self.unauth_client,
            oauth::MICROSOFT_LOGIN_BASE_URL,
            &credentials.tenant_id,
        )
        .await
        .map_err(|error| {
            tracing::error!(error=?error, "unable to fetch Microsoft OIDC signing keys");
            FusionAuthClientError::Generic(GenericErrorResponse {
                message: error.to_string(),
            })
        })?;

        oauth::decode_microsoft_id_token(
            id_token,
            &signing_keys,
            &credentials.client_id,
            &credentials.tenant_id,
        )
        .map_err(|error| {
            tracing::error!(error=?error, "unable to parse Microsoft ID token");
            FusionAuthClientError::Generic(GenericErrorResponse {
                message: error.to_string(),
            })
        })
    }

    fn microsoft_credentials(&self) -> Result<&MicrosoftOAuthCredentials> {
        self.microsoft_credentials
            .as_ref()
            .ok_or(FusionAuthClientError::MicrosoftOAuthNotConfigured)
    }
}
