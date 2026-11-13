use std::fmt;

use macro_service_urls::{MicrosoftGraphUrl, MicrosoftLoginPageUrl, MicrosoftLoginUrl};

use crate::{
    FusionAuthClient, Result,
    error::{FusionAuthClientError, GenericErrorResponse},
};

/// Microsoft OAuth token and ID-token operations.
pub mod oauth;
/// Runtime Graph-token refresh and mailbox identity verification.
pub mod runtime;

#[cfg(test)]
mod test;

#[derive(Clone)]
pub(crate) struct MicrosoftOAuthCredentials {
    client_id: String,
    client_secret: String,
    tenant_id: String,
    /// Microsoft's login host as this service reaches it: code exchange,
    /// refresh, discovery and signing keys.
    login_url: String,
    /// Microsoft's login host as a browser reaches it: the consent pages.
    login_page_url: String,
    /// The Microsoft Graph API root.
    graph_url: String,
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
    /// Microsoft is reached where `MicrosoftLoginUrl`, `MicrosoftLoginPageUrl`
    /// and `MicrosoftGraphUrl` say.
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
            login_url: MicrosoftLoginUrl::unwrap_new().to_string(),
            login_page_url: MicrosoftLoginPageUrl::unwrap_new().to_string(),
            graph_url: MicrosoftGraphUrl::unwrap_new().to_string(),
        });
        self
    }

    /// Sets where Microsoft is reached, in place of the typed service URLs:
    /// the login host for this service's calls, the login host for the
    /// browser's pages, and the Graph API root. For tests that run against
    /// `crates/outlook_emulator`. Call it after
    /// [`Self::with_microsoft_credentials`].
    pub fn with_microsoft_urls(
        mut self,
        login_url: String,
        login_page_url: String,
        graph_url: String,
    ) -> Self {
        if let Some(credentials) = &mut self.microsoft_credentials {
            credentials.login_url = login_url;
            credentials.login_page_url = login_page_url;
            credentials.graph_url = graph_url;
        }
        self
    }

    /// Constructs a tenant-specific Microsoft OAuth authorization URL.
    ///
    /// `state` is opaque and is only URL-encoded, never JSON-serialized.
    pub fn construct_microsoft_authorize_url(
        &self,
        redirect_uri: &str,
        state: &str,
    ) -> Result<String> {
        let credentials = self.microsoft_credentials()?;
        oauth::construct_authorize_url(
            &credentials.login_page_url,
            &credentials.client_id,
            &credentials.tenant_id,
            redirect_uri,
            state,
        )
        .map_err(FusionAuthClientError::from)
    }

    /// Binds an authorization request to a server-owned PKCE verifier and nonce.
    ///
    /// `state` is opaque and is only URL-encoded, never JSON-serialized.
    pub fn construct_bound_microsoft_authorize_url(
        &self,
        redirect_uri: &str,
        state: &str,
        challenge: &str,
        nonce: &str,
        calendar: bool,
    ) -> Result<String> {
        let mut url =
            reqwest::Url::parse(&self.construct_microsoft_authorize_url(redirect_uri, state)?)
                .map_err(|_| {
                    FusionAuthClientError::Generic(GenericErrorResponse {
                        message: "invalid Microsoft authorization URL".into(),
                    })
                })?;
        if calendar {
            let pairs: Vec<(String, String)> = url
                .query_pairs()
                .filter(|(key, _)| key != "scope")
                .map(|(key, value)| (key.into_owned(), value.into_owned()))
                .collect();
            url.query_pairs_mut()
                .clear()
                .extend_pairs(pairs)
                .append_pair("scope", &oauth::consent_scopes(true));
        }
        url.query_pairs_mut()
            .append_pair("code_challenge", challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("nonce", nonce);
        Ok(url.into())
    }

    /// Constructs the tenant-wide admin-consent URL an administrator completes
    /// when their directory does not let users consent to Macro themselves.
    ///
    /// `state` is opaque and is only URL-encoded, never JSON-serialized.
    pub fn construct_microsoft_admin_consent_url(
        &self,
        redirect_uri: &str,
        state: &str,
        calendar: bool,
    ) -> Result<String> {
        let credentials = self.microsoft_credentials()?;
        oauth::construct_admin_consent_url(
            &credentials.login_page_url,
            &credentials.client_id,
            &credentials.tenant_id,
            redirect_uri,
            state,
            calendar,
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
            &credentials.login_url,
            &credentials.client_id,
            &credentials.client_secret,
            &credentials.tenant_id,
            redirect_uri,
            code,
            None,
        )
        .await
    }

    /// Exchanges a code only with the verifier belonging to the linking attempt.
    pub async fn exchange_bound_microsoft_code(
        &self,
        code: &str,
        redirect_uri: &str,
        verifier: &str,
    ) -> Result<oauth::MicrosoftExchangeTokenResponse> {
        let credentials = self.microsoft_credentials()?;
        oauth::exchange_code_for_tokens(
            &credentials.login_url,
            &credentials.client_id,
            &credentials.client_secret,
            &credentials.tenant_id,
            redirect_uri,
            code,
            Some(verifier),
        )
        .await
    }

    /// Validates the ID token and its binding to this particular browser flow.
    pub async fn parse_bound_microsoft_id_token(
        &self,
        id_token: &str,
        nonce: &str,
    ) -> Result<oauth::MicrosoftUserInfo> {
        let credentials = self.microsoft_credentials()?;
        let keys = oauth::fetch_microsoft_signing_keys(
            &self.unauth_client,
            &credentials.login_url,
            &credentials.tenant_id,
        )
        .await
        .map_err(FusionAuthClientError::from)?;
        oauth::decode_bound_microsoft_id_token(
            id_token,
            &keys,
            &credentials.client_id,
            &credentials.tenant_id,
            Some(nonce),
        )
        .map_err(FusionAuthClientError::from)
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
            &credentials.login_url,
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
