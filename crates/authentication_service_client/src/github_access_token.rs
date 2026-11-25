use crate::AuthServiceClient;
use crate::error::{AuthServiceClientError, GenericErrorResponse};
use model::authentication::github_token::GithubAccessToken;

/// The header naming the user an internal call acts for.
const INTERNAL_MACRO_USER_ID_HEADER: &str = "x-internal-macro-user-id";

/// Where a user's GitHub account link stands.
#[derive(Debug)]
pub enum GithubLink {
    /// Linked, with a token GitHub still accepts.
    Linked(GithubAccessToken),
    /// Linked, but GitHub no longer accepts the token: the user must link
    /// again.
    ReauthenticationRequired,
    /// Never linked, or unlinked since.
    NotLinked,
}

impl AuthServiceClient {
    /// The user's GitHub token from their account link. `None` when they
    /// never linked or the token no longer works; either way they have to
    /// link GitHub before it can be used.
    #[tracing::instrument(skip(self), err)]
    pub async fn get_github_access_token(
        &self,
        macro_user_id: &str,
    ) -> Result<Option<GithubAccessToken>, AuthServiceClientError> {
        Ok(match self.get_github_link(macro_user_id).await? {
            GithubLink::Linked(token) => Some(token),
            GithubLink::ReauthenticationRequired | GithubLink::NotLinked => None,
        })
    }

    /// Where the user's GitHub account link stands, with its token when
    /// GitHub still accepts it.
    #[tracing::instrument(skip(self), err)]
    pub async fn get_github_link(
        &self,
        macro_user_id: &str,
    ) -> Result<GithubLink, AuthServiceClientError> {
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
            reqwest::StatusCode::OK => res
                .json::<GithubAccessToken>()
                .await
                .map(GithubLink::Linked)
                .map_err(|e| {
                    AuthServiceClientError::Generic(GenericErrorResponse {
                        message: e.to_string(),
                    })
                }),
            reqwest::StatusCode::NOT_FOUND => Ok(GithubLink::NotLinked),
            reqwest::StatusCode::PRECONDITION_REQUIRED => Ok(GithubLink::ReauthenticationRequired),
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

    /// Unlink the user's GitHub account, as the user would from settings.
    /// Succeeds when there was no link.
    #[tracing::instrument(skip(self), err)]
    pub async fn delete_github_link(
        &self,
        macro_user_id: &str,
    ) -> Result<(), AuthServiceClientError> {
        let res = self
            .client
            .delete(format!("{}/link/github", self.url))
            .header(INTERNAL_MACRO_USER_ID_HEADER, macro_user_id)
            .send()
            .await
            .map_err(|e| AuthServiceClientError::RequestBuildError {
                details: e.to_string(),
            })?;

        match res.status() {
            status if status.is_success() => Ok(()),
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
