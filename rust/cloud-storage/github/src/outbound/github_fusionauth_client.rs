//! Github FusionAuth implementation of the [`FusionAuth`] port.

use fusionauth::{
    FusionAuthClient,
    identity_provider::{IdentityProviderLink, LinkUserRequest},
};

use crate::domain::ports::FusionAuth;

/// Github FusionAuth implementation
#[derive(Clone)]
pub struct GithubFusionAuthImpl {
    /// The fusionauth client
    fusionauth_client: FusionAuthClient,
}

impl GithubFusionAuthImpl {
    /// Create a new instance of GithubFusionAuthImpl
    pub fn new(fusionauth_client: FusionAuthClient) -> Self {
        Self { fusionauth_client }
    }
}

impl FusionAuth for GithubFusionAuthImpl {
    type Err = anyhow::Error;

    #[tracing::instrument(skip(self), err)]
    async fn link_user(
        &self,
        fusionauth_user_id: &uuid::Uuid,
        idp_id: &str,
        github_user_id: &str,
        username: &str,
        access_token: &str,
    ) -> Result<(), Self::Err> {
        self.fusionauth_client
            .link_user(LinkUserRequest {
                identity_provider_link: IdentityProviderLink {
                    display_name: username.into(),
                    identity_provider_id: idp_id.into(),
                    identity_provider_user_id: github_user_id.into(),
                    user_id: fusionauth_user_id.to_string().into(),
                    token: access_token.into(),
                },
            })
            .await?;

        Ok(())
    }
}
