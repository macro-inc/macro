use crate::AuthServiceClient;
use crate::error::{AuthServiceClientError, GenericErrorResponse};

impl AuthServiceClient {
    /// Hard-deletes the dedicated FusionAuth user minted for a shared mailbox after the
    /// mailbox is torn down. The server refuses active users, so this cannot remove a
    /// real account. Idempotent on an already-deleted user.
    #[tracing::instrument(skip(self), err)]
    pub async fn delete_inbox_grant_user(
        &self,
        fusionauth_user_id: &str,
    ) -> Result<(), AuthServiceClientError> {
        let res = self
            .client
            .delete(format!("{}/internal/delete_inbox_grant_user", self.url))
            .query(&[("fusionauth_user_id", fusionauth_user_id)])
            .send()
            .await
            .map_err(|e| AuthServiceClientError::RequestBuildError {
                details: e.to_string(),
            })?;

        match res.status() {
            reqwest::StatusCode::OK => Ok(()),
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
