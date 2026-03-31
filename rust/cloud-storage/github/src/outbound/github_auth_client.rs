//! Github FusionAuth implementation of the [`Auth`] port.

use anyhow::Context;
use fusionauth::{
    FusionAuthClient,
    error::FusionAuthClientError,
    identity_provider::{IdentityProviderLink, LinkUserRequest},
};
use redis::AsyncCommands;
use redis::aio::MultiplexedConnection;

use crate::domain::{
    models::{GithubAccessToken, GithubLink},
    ports::Auth,
};

/// TTL for github tokens: 1 day
const TTL_SECONDS: u64 = 60 * 60 * 24;

/// Generates the key for the github access token in redis
macro_rules! github_access_token_key {
    ($fusionauth_user_id:expr) => {
        format!("github_access_token_key:{}", $fusionauth_user_id)
    };
}

/// Github FusionAuth implementation
#[derive(Clone)]
pub struct GithubAuthImpl {
    /// The fusionauth client
    fusionauth_client: FusionAuthClient,
    /// Redis connection
    conn: MultiplexedConnection,
}

impl GithubAuthImpl {
    /// Create a new instance of GithubAuthImpl
    pub fn new(fusionauth_client: FusionAuthClient, conn: MultiplexedConnection) -> Self {
        Self {
            fusionauth_client,
            conn,
        }
    }
}

impl Auth for GithubAuthImpl {
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

    #[tracing::instrument(skip(self), err)]
    async fn retreive_access_token(
        &self,
        fusionauth_user_id: &uuid::Uuid,
        github_idp_id: &str,
    ) -> Result<GithubAccessToken, Self::Err> {
        let key = github_access_token_key!(fusionauth_user_id);
        let mut conn = self.conn.clone();

        if let Some(access_token) = conn.get::<&str, Option<String>>(&key).await? {
            conn.expire::<&str, ()>(&key, TTL_SECONDS as i64).await?;
            return Ok(GithubAccessToken::new(access_token));
        }

        let links = self
            .fusionauth_client
            .get_links(
                &fusionauth_user_id.to_string(),
                Some(github_idp_id.to_string()),
            )
            .await?;

        if links.is_empty() {
            anyhow::bail!("user does not have a github link")
        }

        // SAFETY: at the moment, we only support 1 github link per user
        let link = links.first().context("links should not be empty")?;

        conn.set_ex::<&str, &str, ()>(&key, &link.token, TTL_SECONDS)
            .await?;

        Ok(GithubAccessToken::new(link.token.clone()))
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_user_link(
        &self,
        github_link: &GithubLink,
        github_idp_id: &str,
    ) -> Result<(), Self::Err> {
        match self
            .fusionauth_client
            .unlink_user(
                &github_link.fusionauth_user_id.to_string(),
                github_idp_id,
                &github_link.github_user_id,
            )
            .await
        {
            Ok(()) | Err(FusionAuthClientError::NoIdentityProviderFound) => Ok(()),
            Err(e) => Err(e.into()),
        }
    }
}
