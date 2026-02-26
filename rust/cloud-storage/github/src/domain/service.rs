//! Github service implementation.

use chrono::Utc;
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};

use crate::domain::{
    models::{GithubError, GithubLink},
    ports::{Auth, GithubOauth, GithubRepo, GithubService},
};

/// Github config
#[derive(Debug)]
pub struct GithubConfig {
    /// The github application client id
    pub client_id: String,
    /// The github application client secret
    pub client_secret: String,
    /// The id of the github identity provider in fusionauth
    pub idp_id: String,
}

/// The concrete github service implementation.
pub struct GithubServiceImpl<R: GithubRepo, U: GithubOauth, F: Auth> {
    repo: R,
    oauth: U,
    auth: F,
    config: GithubConfig,
}

impl<R: GithubRepo, U: GithubOauth, F: Auth> GithubServiceImpl<R, U, F> {
    /// Create a new github service.
    pub fn new(repo: R, oauth: U, auth: F, config: GithubConfig) -> Self {
        Self {
            repo,
            oauth,
            auth,
            config,
        }
    }
}

impl<R: GithubRepo, U: GithubOauth, F: Auth> GithubService for GithubServiceImpl<R, U, F> {
    #[tracing::instrument(skip(self), err)]
    fn construct_oauth_url<T: serde::Serialize + std::fmt::Debug + 'static>(
        &self,
        redirect_uri: &str,
        state: T,
    ) -> Result<String, GithubError> {
        self.oauth
            .construct_oauth_url(&self.config.client_id, redirect_uri, state)
            .map_err(|e| GithubError::Internal(e.into()))
    }

    #[tracing::instrument(skip(self), err)]
    async fn link_user(
        &self,
        user_id: &MacroUserId<Lowercase<'static>>,
        fusionauth_user_id: &uuid::Uuid,
        in_progess_link_id: &uuid::Uuid,
        redirect_uri: &str,
        code: &str,
    ) -> Result<GithubLink, GithubError> {
        let tokens = self
            .oauth
            .exchange_oauth_code_for_tokens(
                &self.config.client_id,
                &self.config.client_secret,
                redirect_uri,
                code,
            )
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        let user_info = self
            .oauth
            .get_user_info(&tokens.access_token)
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        tracing::trace!(user_info=?user_info, "got user info");

        // Check if Github account is already linked to a different user
        match self
            .repo
            .get_github_link_by_github_user_id(&user_info.id.to_string())
            .await
        {
            Ok(link) => {
                if !link.macro_id.0.eq(user_id) {
                    return Err(GithubError::AccountAlreadyLinked);
                }
            }
            Err(e) => {
                let err: anyhow::Error = e.into();
                // We should only error if the error is something other
                // than the link not existing
                if !err.to_string().contains("no rows returned") {
                    return Err(GithubError::Internal(err));
                }
            }
        }

        self.auth
            .link_user(
                fusionauth_user_id,
                &self.config.idp_id,
                &user_info.id.to_string(),
                &user_info.login,
                &tokens.access_token,
            )
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        tracing::trace!("linked auth user");

        // create github link
        let link = GithubLink {
            id: macro_uuid::generate_uuid_v7(),
            macro_id: MacroUserIdStr(user_id.clone()),
            fusionauth_user_id: *fusionauth_user_id,
            github_username: user_info.login.clone(),
            github_user_id: user_info.id.to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        tracing::debug!(
            fusionauth_user_id=%fusionauth_user_id,
            github_user_id=%user_info.id,
            github_username=%user_info.login,
            "creating github_links record"
        );

        self.repo
            .insert_github_link(&link)
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        tracing::trace!("successfully linked github account");

        // SAFETY: this is ok to fail as we have an auto cleanup job for this table
        let _ = self
            .repo
            .delete_in_progress_user_link(in_progess_link_id)
            .await
            .inspect_err(|e| tracing::error!(error=?e, "unable to delete in progress link id"));

        Ok(link)
    }
}
