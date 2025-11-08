use crate::AuthServiceClient;
use crate::error::{AuthServiceClientError, GenericErrorResponse};

impl AuthServiceClient {
    /// Unlinks a user from an identity provider by idp name
    #[tracing::instrument(skip(self))]
    pub async fn remove_link(
        &self,
        fusionauth_user_id: &str,
        macro_id: &str,
        idp_name: &str,
    ) -> Result<(), AuthServiceClientError> {
        let res = self
            .client
            .delete(format!("{}/internal/remove_link", self.url))
            .query(&[("fusionauth_user_id", fusionauth_user_id)])
            .query(&[("macro_id", macro_id)])
            .query(&[("idp_name", idp_name)])
            .send()
            .await
            .map_err(|e| AuthServiceClientError::RequestBuildError {
                details: e.to_string(),
            })?;

        match res.status() {
            reqwest::StatusCode::OK => Ok(()),
            reqwest::StatusCode::NOT_MODIFIED => Ok(()),
            _ => Err(AuthServiceClientError::Generic(GenericErrorResponse {
                message: res.text().await.map_err(|e| {
                    AuthServiceClientError::Generic(GenericErrorResponse {
                        message: e.to_string(),
                    })
                })?,
            })),
        }
    }
}
