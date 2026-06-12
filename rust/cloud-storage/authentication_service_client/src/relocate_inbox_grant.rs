use crate::AuthServiceClient;
use crate::error::{AuthServiceClientError, GenericErrorResponse};

#[derive(serde::Serialize)]
struct RelocateInboxGrantRequest<'a> {
    email: &'a str,
    owner_fusionauth_user_id: &'a str,
}

#[derive(serde::Deserialize)]
struct RelocateInboxGrantResponse {
    shared_fusionauth_user_id: String,
}

impl AuthServiceClient {
    /// Provisions a dedicated FusionAuth user for a shared mailbox and relocates the
    /// mailbox's Google grant onto it (off `owner_fusionauth_user_id`). Returns the shared
    /// user's id so the caller can re-home the link's `fusionauth_user_id`. Idempotent.
    #[tracing::instrument(skip(self), err)]
    pub async fn relocate_inbox_grant(
        &self,
        email: &str,
        owner_fusionauth_user_id: &str,
    ) -> Result<String, AuthServiceClientError> {
        let res = self
            .client
            .post(format!("{}/internal/relocate_inbox_grant", self.url))
            .json(&RelocateInboxGrantRequest {
                email,
                owner_fusionauth_user_id,
            })
            .send()
            .await
            .map_err(|e| AuthServiceClientError::RequestBuildError {
                details: e.to_string(),
            })?;

        match res.status() {
            reqwest::StatusCode::OK => {
                let result = res
                    .json::<RelocateInboxGrantResponse>()
                    .await
                    .map_err(|e| {
                        AuthServiceClientError::Generic(GenericErrorResponse {
                            message: e.to_string(),
                        })
                    })?;
                Ok(result.shared_fusionauth_user_id)
            }
            reqwest::StatusCode::NOT_FOUND => Err(AuthServiceClientError::NotFound),
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
