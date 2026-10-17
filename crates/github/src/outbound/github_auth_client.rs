//! Github FusionAuth implementation of the [`Auth`] port.

use fusionauth::{
    FusionAuthClient,
    error::FusionAuthClientError,
    identity_provider::{IdentityProviderLink, LinkUserRequest},
};
use redis::AsyncCommands;
use redis::aio::MultiplexedConnection;

use crate::domain::{
    models::{GithubAccessToken, GithubError, GithubLink},
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

    async fn clear_access_token_cache(
        &self,
        fusionauth_user_id: &uuid::Uuid,
    ) -> Result<(), GithubError> {
        let key = github_access_token_key!(fusionauth_user_id);
        let mut conn = self.conn.clone();
        conn.del::<&str, ()>(&key).await.map_err(cache_error)?;
        Ok(())
    }
}

/// FusionAuth outages are upstream failures; anything else is ours.
fn fusionauth_error(error: FusionAuthClientError) -> GithubError {
    match error.upstream() {
        Some(upstream) => GithubError::Upstream(upstream),
        None => GithubError::Internal(error.into()),
    }
}

fn cache_error(error: redis::RedisError) -> GithubError {
    GithubError::Internal(error.into())
}

impl Auth for GithubAuthImpl {
    type Err = GithubError;

    #[tracing::instrument(skip(self), err)]
    async fn link_user(
        &self,
        fusionauth_user_id: &uuid::Uuid,
        idp_id: &str,
        github_user_id: &str,
        username: &str,
        access_token: &str,
    ) -> Result<(), Self::Err> {
        match self
            .fusionauth_client
            .link_user(LinkUserRequest {
                identity_provider_link: IdentityProviderLink {
                    display_name: username.into(),
                    identity_provider_id: idp_id.into(),
                    identity_provider_user_id: github_user_id.into(),
                    user_id: fusionauth_user_id.to_string().into(),
                    token: access_token.into(),
                },
            })
            .await
        {
            Ok(()) => {}
            Err(FusionAuthClientError::IdentityProviderLinkAlreadyExists) => {
                tracing::info!(
                    fusionauth_user_id=%fusionauth_user_id,
                    "github idp link already exists, proceeding with existing grant"
                );
            }
            Err(e) => return Err(fusionauth_error(e)),
        }

        self.clear_access_token_cache(fusionauth_user_id).await?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn retreive_access_token(
        &self,
        fusionauth_user_id: &uuid::Uuid,
        github_idp_id: &str,
    ) -> Result<Option<GithubAccessToken>, Self::Err> {
        let key = github_access_token_key!(fusionauth_user_id);
        let mut conn = self.conn.clone();

        if let Some(access_token) = conn
            .get::<&str, Option<String>>(&key)
            .await
            .map_err(cache_error)?
        {
            conn.expire::<&str, ()>(&key, TTL_SECONDS as i64)
                .await
                .map_err(cache_error)?;
            return Ok(Some(GithubAccessToken::new(access_token)));
        }

        let links = match self
            .fusionauth_client
            .get_links(
                &fusionauth_user_id.to_string(),
                Some(github_idp_id.to_string()),
            )
            .await
        {
            Ok(links) => links,
            Err(FusionAuthClientError::UserDoesNotExist) => {
                tracing::warn!(
                    fusionauth_user_id=%fusionauth_user_id,
                    "github link names a fusionauth user that no longer exists"
                );
                return Ok(None);
            }
            Err(e) => return Err(fusionauth_error(e)),
        };

        // SAFETY: each Macro user links at most one GitHub account, and many users can share one GitHub account. For shared accounts, every github_links row stores the owner's fusionauth_user_id, so this lookup resolves to the owner's single shared FusionAuth grant (and its cached token).
        let Some(link) = links.first() else {
            tracing::warn!(
                fusionauth_user_id=%fusionauth_user_id,
                "fusionauth user has no github link"
            );
            return Ok(None);
        };

        conn.set_ex::<&str, &str, ()>(&key, &link.token, TTL_SECONDS)
            .await
            .map_err(cache_error)?;

        Ok(Some(GithubAccessToken::new(link.token.clone())))
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
            // A grant whose auth user is gone has nothing left to unlink.
            Ok(())
            | Err(
                FusionAuthClientError::NoIdentityProviderFound
                | FusionAuthClientError::UserDoesNotExist,
            ) => {
                self.clear_access_token_cache(&github_link.fusionauth_user_id)
                    .await?;
                Ok(())
            }
            Err(e) => Err(fusionauth_error(e)),
        }
    }
}
