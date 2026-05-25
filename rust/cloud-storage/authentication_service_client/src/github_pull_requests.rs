use serde::{Serialize, de::DeserializeOwned};

use crate::AuthServiceClient;
use crate::error::{AuthServiceClientError, GenericErrorResponse};

impl AuthServiceClient {
    /// Enriches GitHub pull request references using the given user's GitHub link.
    ///
    /// Callers should use `github::domain::models::EnrichGithubPullRequestsRequest`
    /// and deserialize `github::domain::models::EnrichGithubPullRequestsResponse`.
    #[tracing::instrument(skip(self, request))]
    pub async fn enrich_github_pull_requests<RequestBody, ResponseBody>(
        &self,
        request: &RequestBody,
    ) -> Result<ResponseBody, AuthServiceClientError>
    where
        RequestBody: Serialize,
        ResponseBody: DeserializeOwned,
    {
        let res = self
            .client
            .post(format!("{}/internal/github_pull_requests/enrich", self.url))
            .json(request)
            .send()
            .await
            .map_err(|e| AuthServiceClientError::RequestBuildError {
                details: e.to_string(),
            })?;

        match res.status() {
            reqwest::StatusCode::OK => {
                let result = res.json::<ResponseBody>().await.map_err(|e| {
                    AuthServiceClientError::Generic(GenericErrorResponse {
                        message: e.to_string(),
                    })
                })?;

                Ok(result)
            }
            reqwest::StatusCode::UNAUTHORIZED => Err(AuthServiceClientError::Unauthorized),
            reqwest::StatusCode::FORBIDDEN => Err(AuthServiceClientError::Forbidden),
            reqwest::StatusCode::NOT_FOUND => Err(AuthServiceClientError::NotFound),
            reqwest::StatusCode::INTERNAL_SERVER_ERROR => {
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
