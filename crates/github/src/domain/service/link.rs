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

    /// Turns a "no rows returned" lookup failure into `None` so a missing link
    /// reads as an absent link rather than an error.
    fn optional_link(result: Result<GithubLink, R::Err>) -> Result<Option<GithubLink>, GithubError> {
        match result {
            Ok(link) => Ok(Some(link)),
            Err(error) => {
                let error: anyhow::Error = error.into();
                if error.to_string().contains("no rows returned") {
                    Ok(None)
                } else {
                    Err(GithubError::Internal(error))
                }
            }
        }
    }

    /// Stores a freshly issued access token on the FusionAuth grant that
    /// `fusionauth_user_id` owns, creating the IdP link when it does not exist
    /// yet and replacing its token when it does.
    async fn store_access_token(
        &self,
        fusionauth_user_id: &uuid::Uuid,
        github_user_id: &str,
        github_username: &str,
        access_token: &str,
    ) -> Result<(), GithubError> {
        self.auth
            .link_user(
                fusionauth_user_id,
                &self.config.idp_id,
                github_user_id,
                github_username,
                access_token,
            )
            .await
            .map_err(|e| GithubError::Internal(e.into()))
    }

    /// Removes a `github_links` row.
    ///
    /// The FusionAuth IdP link + token live on the owner's row and are reused by
    /// every sharer, so the grant is only torn down when this is the last row
    /// for the GitHub account.
    async fn retire_link(&self, link: &GithubLink) -> Result<(), GithubError> {
        let link_count = self
            .repo
            .count_github_links_by_github_user_id(&link.github_user_id)
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        if link_count > 1 {
            // Other Macro users still share this GitHub account: leave the
            // FusionAuth grant in place so the remaining sharers keep working.
            //
            // Note: if the row being deleted is the OWNER's, the FusionAuth link
            // becomes orphaned (no row carries the IdP link anymore), but this is
            // benign — sharers still resolve the grant via the owner's
            // `fusionauth_user_id` stored on their own rows, and the final row
            // deletion below (when the last sharer leaves) cleans it up.
        } else {
            // This is the last/only row for this GitHub account: unlink
            // FusionAuth (and clear the Redis cache) before removing the row.
            self.auth
                .delete_user_link(link, &self.config.idp_id)
                .await
                .map_err(|e| GithubError::Internal(e.into()))?;
        }

        self.repo
            .delete_github_link(&link.id)
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        Ok(())
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
        let link =
            Self::optional_link(self.repo.get_github_link_by_user_id(macro_user_id).await)?;

        let Some(link) = link else {
            tracing::trace!("no github link found for user");
            return Ok(());
        };

        self.retire_link(&link).await
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

        let gh_id = user_info.id.to_string();

        // 1. Does THIS user already have a link, and to which account?
        let this_user_link = Self::optional_link(self.repo.get_github_link_by_user_id(user_id).await)?;

        if let Some(existing) = &this_user_link
            && existing.github_user_id == gh_id
        {
            // Re-running OAuth for the account this user is already linked to is
            // a re-authentication, so the row is kept (inserting again would
            // violate the (macro_id, github_user_id) unique) but the freshly
            // issued token must still replace the stale one. The row's
            // `fusionauth_user_id` is the grant it resolves through, which for a
            // sharer is the account owner's shared grant.
            self.store_access_token(
                &existing.fusionauth_user_id,
                &gh_id,
                &user_info.login,
                &tokens.access_token,
            )
            .await?;

            let _ = self
                .repo
                .delete_in_progress_user_link(in_progess_link_id)
                .await
                .inspect_err(|e| tracing::error!(error=?e, "unable to delete in progress link id"));
            return Ok(existing.clone());
        }

        // The user authorized a DIFFERENT github account than the one they are
        // linked to. A Macro user carries a single github account, so retire the
        // stale row before inserting the new one; leaving it behind would make
        // `get_github_link_by_user_id` resolve to whichever row sorts first.
        if let Some(stale_link) = &this_user_link {
            tracing::debug!(
                stale_github_user_id=%stale_link.github_user_id,
                github_user_id=%gh_id,
                "retiring github link for a different account before relinking"
            );
            self.retire_link(stale_link).await?;
        }

        // 2. Does anyone already OWN this github account? (owner row = earliest row)
        let account_owner =
            Self::optional_link(self.repo.get_github_link_by_github_user_id(&gh_id).await)?;

        let row_fusionauth_user_id = match &account_owner {
            Some(owner) => {
                // SHARER: reuse the owner's shared FusionAuth grant.
                tracing::debug!(
                    owner_fa_id=%owner.fusionauth_user_id,
                    github_user_id=%gh_id,
                    "linking additional macro user as github account sharer"
                );
                owner.fusionauth_user_id
            }
            // OWNER (first linker): the grant is created on this user.
            None => *fusionauth_user_id,
        };

        // Store the token on the grant the new row resolves through. A sharer
        // just proved control of the same github account, so refreshing the
        // owner's shared grant re-authenticates everyone resolving through it
        // rather than stranding them on a token this OAuth round trip replaced.
        self.store_access_token(
            &row_fusionauth_user_id,
            &gh_id,
            &user_info.login,
            &tokens.access_token,
        )
        .await?;

        // create github link
        let link = GithubLink {
            id: macro_uuid::generate_uuid_v7(),
            macro_id: MacroUserIdStr(user_id.clone()),
            fusionauth_user_id: row_fusionauth_user_id,
            github_username: user_info.login.clone(),
            github_user_id: gh_id,
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
