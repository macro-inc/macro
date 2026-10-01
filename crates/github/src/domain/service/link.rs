//! Github Link Service implemenation

use chrono::Utc;
use github_pull_requests::domain::ports::GithubPullRequestService;
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};

use crate::domain::{
    models::{
        EnrichedGithubPullRequest, GithubAccessToken,
        GithubError, GithubLink, GithubMergeMethod, GithubMergeOutcome, GithubMergeRejection,
        GithubPullRequestRef, MergeGithubPullRequestRequest, MergeGithubPullRequestResponse,
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
pub struct GithubLinkServiceImpl<
    R: GithubRepo,
    U: GithubOauth,
    F: Auth,
    E: GithubPullRequestService,
> {
    repo: R,
    oauth: U,
    auth: F,
    pull_request_service: E,
    config: super::GithubLinkConfig,
}

impl<R: GithubRepo, U: GithubOauth, F: Auth, E: GithubPullRequestService>
    GithubLinkServiceImpl<R, U, F, E>
{
    /// Create a new github link service.
    pub fn new(
        repo: R,
        oauth: U,
        auth: F,
        pull_request_service: E,
        config: super::GithubLinkConfig,
    ) -> Self {
        Self {
            repo,
            oauth,
            auth,
            pull_request_service,
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

    /// The merge method for a request that named none: the first the
    /// repository allows. When the settings cannot be read, a merge commit is
    /// attempted and GitHub says so if the repository forbids it; the user
    /// asked to merge, and a readable refusal beats a failed lookup.
    async fn resolve_merge_method(
        &self,
        access_token: &GithubAccessToken,
        request: &MergeGithubPullRequestRequest,
    ) -> Result<GithubMergeMethod, GithubError> {
        if let Some(method) = request.merge_method {
            return Ok(method);
        }

        match self
            .oauth
            .get_repository_merge_settings(access_token.as_str(), &request.owner, &request.repo)
            .await
        {
            Ok(settings) => {
                settings
                    .default_method()
                    .ok_or_else(|| GithubError::PullRequestMergeRejected {
                        rejection: GithubMergeRejection::NotMergeable,
                        message: "This repository does not allow any merge method.".to_string(),
                    })
            }
            Err(error) => {
                tracing::warn!(
                    error=?error,
                    owner=%request.owner,
                    repo=%request.repo,
                    "failed to read repository merge settings, attempting a merge commit"
                );
                Ok(GithubMergeMethod::Merge)
            }
        }
    }

    /// The pull request as GitHub reports it after a merge, written back to
    /// its foreign entities so the app shows it merged before the webhook
    /// arrives. Best-effort: the merge already happened.
    async fn refresh_merged_pull_request(
        &self,
        access_token: &GithubAccessToken,
        reference: GithubPullRequestRef,
    ) -> Option<EnrichedGithubPullRequest> {
        let details = self
            .oauth
            .get_pull_request_details(
                access_token.as_str(),
                &reference.owner,
                &reference.repo,
                reference.number,
            )
            .await
            .inspect_err(|error| {
                tracing::warn!(
                    error=?error,
                    owner=%reference.owner,
                    repo=%reference.repo,
                    number=reference.number,
                    "failed to refresh GitHub pull request after merge"
                );
            })
            .ok()?;
        let pull_request = EnrichedGithubPullRequest::from_details(reference, details);
        self.refresh_stored_pull_request(&pull_request)
            .await;
        Some(pull_request)
    }

    async fn refresh_stored_pull_request(&self, pull_request: &EnrichedGithubPullRequest) {
        if let Err(error) = self
            .pull_request_service
            .refresh_pull_request(pull_request)
            .await
        {
            tracing::warn!(
                error=?error,
                github_key=%pull_request.github_key,
                "failed to refresh stored GitHub pull request"
            );
        }
    }
}

impl<R: GithubRepo, U: GithubOauth, F: Auth, E: GithubPullRequestService> GithubLinkService
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
            .map_err(Self::link_lookup_error)
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
                    self.refresh_stored_pull_request(&enriched_pull_request)
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
    async fn merge_pull_request(
        &self,
        macro_user_id: &MacroUserId<Lowercase<'static>>,
        request: MergeGithubPullRequestRequest,
    ) -> Result<MergeGithubPullRequestResponse, GithubError> {
        let access_token = self.validated_access_token(macro_user_id).await?;
        let merge_method = self.resolve_merge_method(&access_token, &request).await?;

        let outcome = self
            .oauth
            .merge_pull_request(
                access_token.as_str(),
                &request.owner,
                &request.repo,
                request.number,
                merge_method,
            )
            .await
            .map_err(|error| GithubError::Internal(error.into()))?;

        let merge = match outcome {
            GithubMergeOutcome::Merged(merge) => merge,
            GithubMergeOutcome::Rejected { rejection, message } => {
                return Err(GithubError::PullRequestMergeRejected { rejection, message });
            }
        };

        let pull_request = self
            .refresh_merged_pull_request(&access_token, request.to_reference())
            .await;

        Ok(MergeGithubPullRequestResponse {
            sha: merge.sha,
            message: merge.message,
            pull_request,
        })
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

        // Count how many Macro users share this GitHub account. The FusionAuth
        // IdP link + token live on the owner's row and are reused by every
        // sharer, so we must only tear the grant down when this is the last row.
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
                .delete_user_link(&link, &self.config.idp_id)
                .await
                .map_err(|e| GithubError::Internal(e.into()))?;
        }

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

        let gh_id = user_info.id.to_string();

        // 1. Does THIS user already have a link, and to which account?
        let this_user_link = match self.repo.get_github_link_by_user_id(user_id).await {
            Ok(l) => Some(l),
            Err(e) => {
                let e: anyhow::Error = e.into();
                if e.to_string().contains("no rows returned") {
                    None
                } else {
                    return Err(GithubError::Internal(e));
                }
            }
        };

        if let Some(existing) = &this_user_link
            && existing.github_user_id == gh_id
        {
            // Idempotent re-link of the SAME account by the SAME user: skip auth + skip
            // insert (avoids violating the new (macro_id, github_user_id) unique). Still
            // clean up the in-progress link, then return the existing link.
            let _ = self
                .repo
                .delete_in_progress_user_link(in_progess_link_id)
                .await
                .inspect_err(|e| tracing::error!(error=?e, "unable to delete in progress link id"));
            return Ok(existing.clone());
        }
        // else: user previously linked a DIFFERENT github account; fall through and link
        // the new one (frontend is single-valued; not enforced here — matches prior
        // behavior).

        // 2. Does anyone already OWN this github account? (owner row = earliest row)
        let account_owner = match self.repo.get_github_link_by_github_user_id(&gh_id).await {
            Ok(l) => Some(l),
            Err(e) => {
                let e: anyhow::Error = e.into();
                if e.to_string().contains("no rows returned") {
                    None
                } else {
                    return Err(GithubError::Internal(e));
                }
            }
        };

        let row_fusionauth_user_id = match &account_owner {
            Some(owner) => {
                // SHARER: reuse the owner's shared FusionAuth grant. Do NOT call auth.link_user.
                tracing::debug!(
                    owner_fa_id=%owner.fusionauth_user_id,
                    github_user_id=%gh_id,
                    "linking additional macro user as github account sharer"
                );
                owner.fusionauth_user_id
            }
            None => {
                // OWNER (first linker): create the FusionAuth IdP link/token as before.
                self.auth
                    .link_user(
                        fusionauth_user_id,
                        &self.config.idp_id,
                        &gh_id,
                        &user_info.login,
                        &tokens.access_token,
                    )
                    .await
                    .map_err(|e| GithubError::Internal(e.into()))?;

                tracing::trace!("linked auth user");

                *fusionauth_user_id
            }
        };

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
