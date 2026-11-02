use crate::AuthServiceClient;
use crate::error::{AuthServiceClientError, GenericErrorResponse};
use model::authentication::github_token::GithubAccessToken;

impl AuthServiceClient {
    /// The user's GitHub token from their account link. `None` when they
    /// never linked or the token no longer works; either way they have to
    /// link GitHub before it can be used.
    #[tracing::instrument(skip(self), err)]
    pub async fn get_github_access_token(
        &self,
        macro_user_id: &str,
    ) -> Result<Option<GithubAccessToken>, AuthServiceClientError> {
        let res = self
            .client
            .get(format!("{}/internal/github_access_token", self.url))
            .query(&[("macro_user_id", macro_user_id)])
            .send()
            .await
            .map_err(|e| AuthServiceClientError::RequestBuildError {
                details: e.to_string(),
            })?;

        match res.status() {
            reqwest::StatusCode::OK => {
                res.json::<GithubAccessToken>()
                    .await
                    .map(Some)
                    .map_err(|e| {
                        AuthServiceClientError::Generic(GenericErrorResponse {
                            message: e.to_string(),
                        })
                    })
            }
            reqwest::StatusCode::NOT_FOUND | reqwest::StatusCode::PRECONDITION_REQUIRED => Ok(None),
            reqwest::StatusCode::UNAUTHORIZED => Err(AuthServiceClientError::Unauthorized),
            reqwest::StatusCode::FORBIDDEN => Err(AuthServiceClientError::Forbidden),
            status => {
                let details = res.text().await.unwrap_or_default();
                Err(AuthServiceClientError::InternalServerError {
                    details: format!("{status}: {details}"),
                })
            }
        }
    }
}
