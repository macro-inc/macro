use crate::AuthServiceClient;
use crate::error::{AuthServiceClientError, GenericErrorResponse};
use model::authentication::google_token::GoogleAccessToken;

impl AuthServiceClient {
    /// Gets the Google access token for the given fusionauth user id
    #[tracing::instrument(skip(self))]
    pub async fn get_google_access_token(
        &self,
        fusionauth_user_id: &str,
        macro_id: &str,
    ) -> Result<GoogleAccessToken, AuthServiceClientError> {
        let res = self
            .client
            .get(format!("{}/internal/google_access_token", self.url))
            .query(&[("fusionauth_user_id", fusionauth_user_id)])
            .query(&[("macro_id", macro_id)])
            .send()
            .await
            .map_err(|e| AuthServiceClientError::RequestBuildError {
                details: e.to_string(),
            })?;

        match res.status() {
            reqwest::StatusCode::OK => {
                tracing::trace!("user access token retrieved");
                let result = res.json::<GoogleAccessToken>().await.map_err(|e| {
                    AuthServiceClientError::Generic(GenericErrorResponse {
                        message: e.to_string(),
                    })
                })?;

                Ok(result)
            }
            reqwest::StatusCode::UNAUTHORIZED => {
                tracing::error!("unauthorized");
                Err(AuthServiceClientError::Unauthorized)
            }
            reqwest::StatusCode::NOT_FOUND => {
                tracing::error!("not found");
                Err(AuthServiceClientError::NotFound)
            }
            reqwest::StatusCode::INTERNAL_SERVER_ERROR => {
                tracing::error!("internal server error");
                let error_message = res.text().await.map_err(|e| {
                    AuthServiceClientError::Generic(GenericErrorResponse {
                        message: e.to_string(),
                    })
                })?;

                Err(AuthServiceClientError::InternalServerError {
                    details: error_message,
                })
            }
            _ => {
                let body = res.text().await.map_err(|e| {
                    AuthServiceClientError::Generic(GenericErrorResponse {
                        message: e.to_string(),
                    })
                })?;

                Err(AuthServiceClientError::Generic(GenericErrorResponse {
                    message: body,
                }))
            }
        }
    }
}
