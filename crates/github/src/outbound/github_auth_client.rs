//! Github FusionAuth implementation of the [`Auth`] port.

use fusionauth::{
    FusionAuthClient,
    error::FusionAuthClientError,
    identity_provider::{IdentityProviderLink, LinkUserRequest},
};
use redis::AsyncCommands;
use redis::aio::MultiplexedConnection;

use crate::domain::{
    models::{GithubAccessToken, GithubGrantLinkOutcome, GithubLink},
    ports::Auth,
};

/// TTL for github tokens: 1 day
const TTL_SECONDS: u64 = 60 * 60 * 24;

/// Generates the key for the github access token in redis
macro_rules! github_access_token_key {
    ($fusionauth_user_id:expr, $github_user_id:expr) => {
        format!(
            "github_access_token_key:{}:{}",
            $fusionauth_user_id, $github_user_id
        )
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
        github_user_id: &str,
    ) -> Result<(), anyhow::Error> {
        let key = github_access_token_key!(fusionauth_user_id, github_user_id);
        let mut conn = self.conn.clone();
        conn.del::<&str, ()>(&key).await?;
        Ok(())
    }
}

impl Auth for GithubAuthImpl {
    type Err = anyhow::Error;

    #[tracing::instrument(skip(self, username, access_token), err)]
    async fn link_user(
        &self,
        fusionauth_user_id: &uuid::Uuid,
        idp_id: &str,
        github_user_id: &str,
        username: &str,
        access_token: &str,
    ) -> Result<GithubGrantLinkOutcome, Self::Err> {
        self.clear_access_token_cache(fusionauth_user_id, github_user_id)
            .await?;
        let result = refresh_grant(
            &self.fusionauth_client,
            fusionauth_user_id,
            idp_id,
            github_user_id,
            username,
            access_token,
        )
        .await;
        if matches!(&result, Ok(GithubGrantLinkOutcome::Linked)) {
            let key = github_access_token_key!(fusionauth_user_id, github_user_id);
            self.conn
                .clone()
                .set_ex::<&str, &str, ()>(&key, access_token, TTL_SECONDS)
                .await?;
        } else {
            self.clear_access_token_cache(fusionauth_user_id, github_user_id)
                .await?;
        }
        result
    }

    #[tracing::instrument(skip(self), err)]
    async fn retreive_access_token(
        &self,
        fusionauth_user_id: &uuid::Uuid,
        github_idp_id: &str,
        github_user_id: &str,
    ) -> Result<Option<GithubAccessToken>, Self::Err> {
        let key = github_access_token_key!(fusionauth_user_id, github_user_id);
        let mut conn = self.conn.clone();

        if let Some(access_token) = conn.get::<&str, Option<String>>(&key).await? {
            conn.expire::<&str, ()>(&key, TTL_SECONDS as i64).await?;
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
            Err(
                FusionAuthClientError::UserDoesNotExist
                | FusionAuthClientError::NoIdentityProviderFound,
            ) => return Ok(None),
            Err(error) => return Err(error.into()),
        };

        // An identity may retain another account's grant for its remaining sharers.
        let Some(link) = links
            .iter()
            .find(|link| link.identity_provider_user_id == github_user_id)
        else {
            return Ok(None);
        };

        // A lookup that started before reconnect must not overwrite its fresh
        // token. If another writer won, return that token instead of our snapshot.
        let inserted: Option<String> = redis::cmd("SET")
            .arg(&key)
            .arg(&link.token)
            .arg("EX")
            .arg(TTL_SECONDS)
            .arg("NX")
            .query_async(&mut conn)
            .await?;
        let token = if inserted.is_none() {
            conn.get::<&str, Option<String>>(&key)
                .await?
                .unwrap_or_else(|| link.token.clone())
        } else {
            link.token.clone()
        };
        Ok(Some(GithubAccessToken::new(token)))
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
            Ok(())
            | Err(
                FusionAuthClientError::NoIdentityProviderFound
                | FusionAuthClientError::UserDoesNotExist,
            ) => {
                self.clear_access_token_cache(
                    &github_link.fusionauth_user_id,
                    &github_link.github_user_id,
                )
                .await?;
                Ok(())
            }
            Err(e) => Err(e.into()),
        }
    }
}

/// Called while the domain service holds the shared GitHub account lock.
#[tracing::instrument(skip(fusionauth_client, username, access_token), err)]
async fn refresh_grant(
    fusionauth_client: &FusionAuthClient,
    fusionauth_user_id: &uuid::Uuid,
    idp_id: &str,
    github_user_id: &str,
    username: &str,
    access_token: &str,
) -> Result<GithubGrantLinkOutcome, anyhow::Error> {
    // Read FusionAuth directly: a cached token can outlive its identity.
    let links = match fusionauth_client
        .get_links(&fusionauth_user_id.to_string(), Some(idp_id.to_string()))
        .await
    {
        Ok(links) => links,
        Err(FusionAuthClientError::UserDoesNotExist) => {
            return Ok(GithubGrantLinkOutcome::IdentityMissing);
        }
        Err(FusionAuthClientError::NoIdentityProviderFound) => Vec::new(),
        Err(error) => return Err(error.into()),
    };
    let existing = links
        .iter()
        .find(|link| link.identity_provider_user_id == github_user_id);
    if existing.is_some_and(|link| link.token == access_token) {
        return Ok(GithubGrantLinkOutcome::Linked);
    }
    let request = |token: String| LinkUserRequest {
        identity_provider_link: IdentityProviderLink {
            display_name: username.into(),
            identity_provider_id: idp_id.into(),
            identity_provider_user_id: github_user_id.into(),
            user_id: fusionauth_user_id.to_string().into(),
            token: token.into(),
        },
    };
    if existing.is_some() {
        fusionauth_client
            .unlink_user(&fusionauth_user_id.to_string(), idp_id, github_user_id)
            .await?;
    }
    if let Err(error) = fusionauth_client
        .link_user(request(access_token.to_string()))
        .await
    {
        if let Some(existing) = existing {
            // FusionAuth has no update-link API. Restore the old grant if the
            // replacement fails, retaining the original error for the caller.
            if let Err(rollback_error) = fusionauth_client
                .link_user(request(existing.token.clone()))
                .await
            {
                tracing::error!(error=?rollback_error, "unable to restore github grant after failed refresh");
            }
        }
        return Err(error.into());
    }
    Ok(GithubGrantLinkOutcome::Linked)
}

#[cfg(test)]
mod test;
