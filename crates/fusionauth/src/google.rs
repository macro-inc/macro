use crate::{
    FusionAuthClient, Result,
    error::{FusionAuthClientError, GenericErrorResponse},
};

/// Google OAuth token operations.
pub mod oauth;

#[cfg(test)]
mod test;

impl FusionAuthClient {
    /// Revokes a Google grant at Google, so the account's next consent screen
    /// starts from nothing. `token` is an access or refresh token of the grant.
    #[tracing::instrument(name = "google.revoke_grant", skip(self, token), err)]
    pub async fn revoke_google_grant(&self, token: &str) -> Result<()> {
        oauth::revoke_token(&self.unauth_client, oauth::GOOGLE_REVOKE_URL, token).await
    }

    /// Refreshes a Google OAuth2 access token using a refresh token.
    #[tracing::instrument(skip(self, refresh_token), fields(client_id=%self.client_id))]
    pub async fn refresh_google_token(
        &self,
        refresh_token: &str,
    ) -> Result<oauth::GoogleTokenResponse> {
        oauth::refresh_google_token(
            &self.unauth_client,
            &self.google_client_id,
            &self.google_client_secret,
            refresh_token,
        )
        .await
    }

    /// Exchanges a Google authorization code for tokens.
    #[tracing::instrument(skip(self, code, redirect_uri))]
    pub async fn exchange_google_code_for_tokens(
        &self,
        code: &str,
        redirect_uri: &str,
    ) -> Result<oauth::GoogleExchangeTokenResponse> {
        oauth::exchange_code_for_tokens(
            &self.unauth_client,
            &self.google_client_id,
            &self.google_client_secret,
            redirect_uri,
            code,
        )
        .await
    }

    /// Parses and decodes a Google ID token to extract user info.
    #[tracing::instrument(skip(self, id_token))]
    pub fn parse_google_id_token(&self, id_token: &str) -> Result<oauth::GoogleUserInfo> {
        let result = oauth::decode_google_id_token(id_token).map_err(|e| {
            tracing::error!(error=?e, "unable to parse google id token");
            FusionAuthClientError::Generic(GenericErrorResponse {
                message: e.to_string(),
            })
        })?;

        Ok(result)
    }
}
