//! Github service implementation.

use chrono::Utc;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};

use crate::domain::{
    models::{GithubError, GithubLink},
    ports::{FusionAuth, GithubOauth, GithubRepo, GithubService},
};

/// The concrete github service implementation.
pub struct GithubServiceImpl<R: GithubRepo, U: GithubOauth, F: FusionAuth> {
    repo: R,
    oauth: U,
    fusion: F,
}

impl<R: GithubRepo, U: GithubOauth, F: FusionAuth> GithubServiceImpl<R, U, F> {
    /// Create a new github service.
    pub fn new(repo: R, oauth: U, fusion: F) -> Self {
        Self {
            repo,
            oauth,
            fusion,
        }
    }
}

impl<R: GithubRepo, U: GithubOauth, F: FusionAuth> GithubService for GithubServiceImpl<R, U, F> {
    fn construct_oauth_url<T: serde::Serialize + std::fmt::Debug + 'static>(
        &self,
        redirect_uri: &str,
        state: T,
    ) -> Result<String, GithubError> {
        self.oauth
            .construct_oauth_url(redirect_uri, state)
            .map_err(|e| GithubError::Internal(e.into()))
    }

    async fn link_user<'a>(
        &self,
        redirect_uri: &str,
        code: &str,
        fusionauth_user_id: &uuid::Uuid,
        macro_user_id: &MacroUserId<Lowercase<'static>>,
    ) -> Result<GithubLink, GithubError> {
        let tokens = self
            .oauth
            .exchange_oauth_code_for_tokens(redirect_uri, code)
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        let user_info = self
            .oauth
            .get_user_info(&tokens.access_token)
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        // Check if Github account is already linked to a different user
        match self
            .repo
            .get_github_link_by_github_user_id(&user_info.id.to_string())
            .await
        {
            Ok(link) => {
                if !link.macro_id.0.eq(macro_user_id) {
                    return Err(GithubError::AccountAlreadyLinked);
                }
            }
            Err(e) => {
                let err: anyhow::Error = e.into();
                // We should only error if the error is something other
                // than the link not existing
                if !err.to_string().contains("no link found") {
                    return Err(GithubError::Internal(err));
                }
            }
        }

        self.fusion
            .link_user(
                &fusion_user_id,
                "",
                &user_info.id.to_string(),
                &user_info.login,
                &tokens.access_token,
            )
            .await
            .map_err(|e| GithubError::Internal(e))?;

        // Link in FusionAuth
        fusionauth_client
            .link_user(
                &fusionauth_user_id.to_string(),
                &config.idp_id,
                &user_info.id.to_string(),
                &user_info.login,
                &token_response.access_token,
            )
            .await
            .map_err(|e| GithubIntegrationError::FusionAuthLinkingFailed(e.to_string()))?;

        // create github link

        // Create github_links record
        let link = GithubLink {
            id: macro_uuid::generate_uuid_v7(),
            macro_id: fusionauth_user_id.to_string(),
            fusionauth_user_id,
            github_username: user_info.login.clone(),
            github_user_id: user_info.id.to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        tracing::info!(
            fusionauth_user_id=%fusionauth_user_id,
            github_user_id=%user_info.id,
            github_username=%user_info.login,
            "creating github_links record"
        );

        db::create_github_link(pool, link).await.inspect_err(|e| {
            tracing::error!(error=?e, "failed to create github_links record");

            // Note: Cleanup of FusionAuth link should be handled by caller
            // if they want to implement async cleanup on failure
        })?;

        tracing::trace!("successfully linked Github account");

        Ok(link)
    }
}
