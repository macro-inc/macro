use crate::service::fusionauth_client::{
    FusionAuthClient, Result,
    error::{FusionAuthClientError, GenericErrorResponse},
};

pub mod oauth;

impl FusionAuthClient {
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
