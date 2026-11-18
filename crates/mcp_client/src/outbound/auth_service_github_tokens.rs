//! [`LinkedGithubTokens`] over the authentication service, which owns the
//! GitHub account link.

use authentication_service_client::AuthServiceClient;

use crate::domain::models::MacroUserIdStr;
use crate::domain::ports::LinkedGithubTokens;

/// Reads link tokens from the authentication service on every call, so
/// linking or unlinking GitHub shows up on the next read.
pub struct AuthServiceGithubTokens {
    client: AuthServiceClient,
}

impl AuthServiceGithubTokens {
    /// Read tokens through `client`.
    pub fn new(client: AuthServiceClient) -> Self {
        Self { client }
    }
}

#[async_trait::async_trait]
impl LinkedGithubTokens for AuthServiceGithubTokens {
    #[tracing::instrument(skip_all, err)]
    async fn access_token(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> anyhow::Result<Option<String>> {
        Ok(self
            .client
            .get_github_access_token(user_id.as_ref())
            .await?
            .map(|token| token.access_token))
    }
}
