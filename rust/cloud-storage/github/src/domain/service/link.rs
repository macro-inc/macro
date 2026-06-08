//! Github Link Service implemenation

use chrono::Utc;
use foreign_entity::domain::{models::PatchForeignEntity, ports::ForeignEntityService};
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};

use crate::domain::{
    models::{
        EnrichedGithubPullRequest, GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE, GithubAccessToken,
        GithubError, GithubLink, GithubPullRequestRef,
    },
    ports::{Auth, GithubLinkService, GithubOauth, GithubRepo},
};

/// Github link config
#[derive(Debug)]
pub struct GithubLinkConfig {
    /// The github application client id
    pub client_id: String,
    /// The github application client secret
    pub client_secret: String,
    /// The id of the github identity provider in fusionauth
    pub idp_id: String,
}

/// The concrete github link service implementation.
pub struct GithubLinkServiceImpl<R: GithubRepo, U: GithubOauth, F: Auth, E: ForeignEntityService> {
    repo: R,
    oauth: U,
    auth: F,
    foreign_entity_service: E,
    config: super::GithubLinkConfig,
}

impl<R: GithubRepo, U: GithubOauth, F: Auth, E: ForeignEntityService>
    GithubLinkServiceImpl<R, U, F, E>
{
    /// Create a new github link service.
    pub fn new(
        repo: R,
        oauth: U,
        auth: F,
        foreign_entity_service: E,
        config: super::GithubLinkConfig,
    ) -> Self {
        Self {
            repo,
            oauth,
            auth,
            foreign_entity_service,
            config,
        }
    }

    fn link_lookup_error(error: R::Err) -> GithubError {
        let error: anyhow::Error = error.into();

        if error.to_string().contains("no rows returned") {
            return GithubError::NoLinkFound;
        }

        GithubError::Internal(error)
    }

    async fn get_user_link_for_validation(
        &self,
        macro_user_id: &MacroUserId<Lowercase<'static>>,
    ) -> Result<GithubLink, GithubError> {
        self.repo
            .get_github_link_by_user_id(macro_user_id)
            .await
            .map_err(Self::link_lookup_error)
    }

    async fn validated_access_token(
        &self,
        macro_user_id: &MacroUserId<Lowercase<'static>>,
    ) -> Result<GithubAccessToken, GithubError> {
        let link = self.get_user_link_for_validation(macro_user_id).await?;

        let access_token = self
            .auth
            .retreive_access_token(&link.fusionauth_user_id, &self.config.idp_id)
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        let token_is_expired = self
            .oauth
            .is_access_token_expired(access_token.as_str())
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        if token_is_expired {
            return Err(GithubError::ReauthenticationRequired);
        }

        Ok(access_token)
    }

    async fn patch_pull_request_foreign_entities(&self, pull_request: &EnrichedGithubPullRequest) {
        let foreign_entities = match self
            .foreign_entity_service
            .get_foreign_entities_by_foreign_entity_id(
                &pull_request.github_key,
                Some(GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE),
            )
            .await
        {
            Ok(foreign_entities) => foreign_entities,
            Err(error) => {
                tracing::warn!(
                    error=?error,
                    github_key=%pull_request.github_key,
                    source=%GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
                    "failed to fetch GitHub pull request foreign entities"
                );
                return;
            }
        };

        for foreign_entity in foreign_entities {
            let foreign_entity_record_id = foreign_entity.id;
            let metadata =
                match pull_request.foreign_entity_metadata(Some(&foreign_entity.metadata)) {
                    Ok(metadata) => metadata,
                    Err(error) => {
                        tracing::warn!(
                            error=?error,
                            foreign_entity_record_id=%foreign_entity_record_id,
                            github_key=%pull_request.github_key,
                            "failed to serialize GitHub pull request foreign entity metadata"
                        );
                        continue;
                    }
                };

            let patch = PatchForeignEntity {
                metadata: Some(metadata),
                ..PatchForeignEntity::default()
            };

            if let Err(error) = self
                .foreign_entity_service
                .patch_foreign_entity(foreign_entity_record_id, patch)
                .await
            {
                tracing::warn!(
                    error=?error,
                    foreign_entity_record_id=%foreign_entity_record_id,
                    github_key=%pull_request.github_key,
                    "failed to patch GitHub pull request foreign entity"
                );
            }
        }
    }
}

impl<R: GithubRepo, U: GithubOauth, F: Auth, E: ForeignEntityService> GithubLinkService
    for GithubLinkServiceImpl<R, U, F, E>
{
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
    async fn get_user_link(
        &self,
        macro_user_id: &MacroUserId<Lowercase<'static>>,
    ) -> Result<GithubLink, GithubError> {
        self.repo
            .get_github_link_by_user_id(macro_user_id)
            .await
            .map_err(|e| GithubError::Internal(e.into()))
    }

    #[tracing::instrument(skip(self), err)]
    async fn check_user_link_token(
        &self,
        macro_user_id: &MacroUserId<Lowercase<'static>>,
    ) -> Result<(), GithubError> {
        self.validated_access_token(macro_user_id).await?;
        Ok(())
    }

    #[tracing::instrument(skip(self, pull_requests), err)]
    async fn enrich_pull_requests(
        &self,
        macro_user_id: &MacroUserId<Lowercase<'static>>,
        pull_requests: Vec<GithubPullRequestRef>,
    ) -> Result<Vec<EnrichedGithubPullRequest>, GithubError> {
        if pull_requests.is_empty() {
            return Ok(Vec::new());
        }

        let access_token = self.validated_access_token(macro_user_id).await?;

        let mut enriched_pull_requests = Vec::with_capacity(pull_requests.len());

        for pull_request in pull_requests {
            let details = self
                .oauth
                .get_pull_request_details(
                    access_token.as_str(),
                    pull_request.owner.as_str(),
                    pull_request.repo.as_str(),
                    pull_request.number,
                )
                .await;

            let enriched_pull_request = match details {
                Ok(details) => {
                    let enriched_pull_request =
                        EnrichedGithubPullRequest::from_details(pull_request, details);
                    self.patch_pull_request_foreign_entities(&enriched_pull_request)
                        .await;
                    enriched_pull_request
                }
                Err(e) => {
                    tracing::warn!(
                        error=?e,
                        owner=%pull_request.owner,
                        repo=%pull_request.repo,
                        number=pull_request.number,
                        "failed to enrich GitHub pull request"
                    );

                    EnrichedGithubPullRequest::from_reference(pull_request)
                }
            };

            enriched_pull_requests.push(enriched_pull_request);
        }

        Ok(enriched_pull_requests)
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_user_link(
        &self,
        macro_user_id: &MacroUserId<Lowercase<'static>>,
    ) -> Result<(), GithubError> {
        // Get link
        let link = match self.repo.get_github_link_by_user_id(macro_user_id).await {
            Ok(link) => link,
            Err(e) => {
                let e: anyhow::Error = e.into();
                if e.to_string().contains("no rows returned") {
                    tracing::trace!("no github link found for user");
                    return Ok(());
                }

                return Err(GithubError::Internal(e));
            }
        };

        // Delete link from Auth
        self.auth
            .delete_user_link(&link, &self.config.idp_id)
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        // Delete from repo
        self.repo
            .delete_github_link(&link.id)
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        Ok(())
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
