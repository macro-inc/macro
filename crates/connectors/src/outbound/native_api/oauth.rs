//! Macro's OAuth client at an API app: the authorization URL, the code
//! exchange, refresh, and revocation (RFC 6749, 7636, 7009).
//!
//! The client authenticates with HTTP Basic, as Autodesk requires for a
//! confidential client. Nothing here logs a token, a code, or a vendor's
//! error description.

use crate::outbound::native_api::app::ApiApp;
use rootcause::Report;
use serde::Deserialize;
use std::time::Duration;
use url::Url;
use zeroize::Zeroizing;

#[cfg(test)]
mod test;

/// How long one token request may take.
const TOKEN_TIMEOUT: Duration = Duration::from_secs(15);
/// The OAuth error a dead refresh token (or code) answers with.
const INVALID_GRANT: &str = "invalid_grant";

/// Tokens a token endpoint answered with. Redacts its `Debug`.
pub(crate) struct Tokens {
    pub(crate) access_token: Zeroizing<String>,
    /// A new refresh token; Autodesk issues one on every exchange and
    /// refresh, and the old one stops working.
    pub(crate) refresh_token: Option<Zeroizing<String>>,
    /// Seconds until the access token expires.
    pub(crate) expires_in: u64,
}

impl std::fmt::Debug for Tokens {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Tokens")
            .field("expires_in", &self.expires_in)
            .finish_non_exhaustive()
    }
}

/// Why a token request failed.
#[derive(Debug, thiserror::Error)]
pub(crate) enum TokenError {
    /// The vendor refused the grant (`invalid_grant`): the refresh token is
    /// dead, or the code was used or expired. Only signing in again mends it.
    #[error("the vendor refused the grant")]
    InvalidGrant,
    /// The vendor refused the request otherwise, or answered with what is
    /// not a token response.
    #[error("the token endpoint answered {0}")]
    Refused(http::StatusCode),
    /// The vendor could not be reached.
    #[error("the token endpoint could not be reached")]
    Unreachable,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
}

#[derive(Deserialize)]
struct ErrorResponse {
    error: Option<String>,
}

/// Macro's registered client at one app.
pub(crate) struct OAuthClient {
    app: ApiApp,
    client_id: String,
    client_secret: Zeroizing<String>,
    redirect_uri: Url,
    http: reqwest::Client,
}

impl OAuthClient {
    /// The client `client_id` at `app`, redirecting to `redirect_uri`.
    pub(crate) fn new(
        app: ApiApp,
        client_id: String,
        client_secret: Zeroizing<String>,
        redirect_uri: Url,
    ) -> Result<Self, Report> {
        let http = reqwest::Client::builder()
            .timeout(TOKEN_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(Report::new)?;

        Ok(Self {
            app,
            client_id,
            client_secret,
            redirect_uri,
            http,
        })
    }

    /// The app this client signs in to.
    pub(crate) fn app(&self) -> &ApiApp {
        &self.app
    }

    /// Where the browser goes to authorize: the app's consent page, carrying
    /// the one-time `state` and the PKCE `challenge` (S256).
    pub(crate) fn authorize_url(&self, state: &str, challenge: &str) -> Url {
        let mut url = self.app.authorize_url.clone();
        url.query_pairs_mut()
            .append_pair("response_type", "code")
            .append_pair("client_id", &self.client_id)
            .append_pair("redirect_uri", self.redirect_uri.as_str())
            .append_pair("scope", &self.app.scope)
            .append_pair("state", state)
            .append_pair("code_challenge", challenge)
            .append_pair("code_challenge_method", "S256");
        url
    }

    /// Exchange the code the consent page redirected back with.
    #[tracing::instrument(name = "connectors.api_app_token_exchange", skip_all, fields(app = %self.app.id, http.status_code = tracing::field::Empty), err)]
    pub(crate) async fn exchange(&self, code: &str, verifier: &str) -> Result<Tokens, TokenError> {
        self.token(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", self.redirect_uri.as_str()),
            ("code_verifier", verifier),
        ])
        .await
    }

    /// Spend `refresh_token` on a new access token and refresh token.
    #[tracing::instrument(name = "connectors.api_app_token_refresh", skip_all, fields(app = %self.app.id, http.status_code = tracing::field::Empty), err)]
    pub(crate) async fn refresh(&self, refresh_token: &str) -> Result<Tokens, TokenError> {
        self.token(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("scope", &self.app.scope),
        ])
        .await
    }

    /// Revoke `refresh_token` at the vendor. A token that is already dead is
    /// not an error (RFC 7009 answers 200 for it).
    #[tracing::instrument(name = "connectors.api_app_token_revoke", skip_all, fields(app = %self.app.id), err)]
    pub(crate) async fn revoke(&self, refresh_token: &str) -> Result<(), TokenError> {
        let response = self
            .http
            .post(self.app.revoke_url.clone())
            .basic_auth(&self.client_id, Some(self.client_secret.as_str()))
            .form(&[
                ("token", refresh_token),
                ("token_type_hint", "refresh_token"),
            ])
            .send()
            .await
            .map_err(|_| TokenError::Unreachable)?;
        let status = response.status();
        if status.is_success() {
            Ok(())
        } else {
            Err(TokenError::Refused(status))
        }
    }

    async fn token(&self, form: &[(&str, &str)]) -> Result<Tokens, TokenError> {
        let response = self
            .http
            .post(self.app.token_url.clone())
            .basic_auth(&self.client_id, Some(self.client_secret.as_str()))
            .form(form)
            .send()
            .await
            .map_err(|_| TokenError::Unreachable)?;
        let status = response.status();
        let body = Zeroizing::new(
            response
                .bytes()
                .await
                .map_err(|_| TokenError::Unreachable)?
                .to_vec(),
        );
        tracing::Span::current().record("http.status_code", status.as_u16());

        if !status.is_success() {
            let error = serde_json::from_slice::<ErrorResponse>(&body)
                .ok()
                .and_then(|answer| answer.error);
            if error.as_deref() == Some(INVALID_GRANT) {
                return Err(TokenError::InvalidGrant);
            }
            tracing::warn!(
                http.status_code = status.as_u16(),
                oauth.error = error.as_deref(),
                "an API app's token endpoint refused a request"
            );
            return Err(TokenError::Refused(status));
        }

        let tokens: TokenResponse =
            serde_json::from_slice(&body).map_err(|_| TokenError::Refused(status))?;
        Ok(Tokens {
            access_token: Zeroizing::new(tokens.access_token),
            refresh_token: tokens.refresh_token.map(Zeroizing::new),
            expires_in: tokens.expires_in.unwrap_or(0),
        })
    }
}
