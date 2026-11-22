//! [`GithubAccountLink`] over the authentication service, which owns the
//! GitHub account link.

use super::{GithubAccountLink, LinkToken};
use crate::outbound::native::models::MacroUserIdStr;
use authentication_service_client::AuthServiceClient;
use authentication_service_client::github_access_token::GithubLink;
use rootcause::Report;

/// Reads the link from the authentication service on every call, so linking
/// or unlinking GitHub shows up on the next read.
pub(crate) struct AuthServiceGithubLink {
    client: AuthServiceClient,
}

impl AuthServiceGithubLink {
    /// Read and unlink through `client`.
    pub(crate) fn new(client: AuthServiceClient) -> Self {
        Self { client }
    }
}

#[async_trait::async_trait]
impl GithubAccountLink for AuthServiceGithubLink {
    #[tracing::instrument(skip_all, err)]
    async fn token(&self, user: &MacroUserIdStr<'static>) -> Result<LinkToken, Report> {
        Ok(match self.client.get_github_link(user.as_ref()).await? {
            GithubLink::Linked(token) => LinkToken::Working(token.access_token),
            GithubLink::ReauthenticationRequired => LinkToken::NeedsReauth,
            GithubLink::NotLinked => LinkToken::NotLinked,
        })
    }

    #[tracing::instrument(skip_all, err)]
    async fn unlink(&self, user: &MacroUserIdStr<'static>) -> Result<(), Report> {
        Ok(self.client.delete_github_link(user.as_ref()).await?)
    }
}
