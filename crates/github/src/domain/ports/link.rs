//! Port definitions for github link operations (OAuth and account linking).

use std::future::Future;

use crate::domain::models::{
    EnableAutoMergeRequest, EnableAutoMergeResponse, EnrichedGithubPullRequest,
    GithubAccessToken, GithubAutoMergeOutcome, GithubError, GithubExchangeTokenResponse,
    GithubLink, GithubMergeMethod, GithubMergeOutcome, GithubPullRequestDetails,
    GithubPullRequestRef, GithubRepositoryMergeSettings, GithubUserInfo,
    MergeGithubPullRequestRequest, MergeGithubPullRequestResponse,
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};

/// Repository for accessing github link data from the database.
///
/// All methods perform database operations — SQL queries are written
/// directly in the outbound adapter implementation.
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait GithubRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: Into<anyhow::Error> + Send + std::fmt::Debug;

    /// Gets the github link by the macro user id
    fn get_github_link_by_user_id<'a>(
        &self,
        macro_user_id: &MacroUserId<Lowercase<'a>>,
    ) -> impl Future<Output = Result<GithubLink, Self::Err>> + Send;

    /// Gets the github link by the github user id
    fn get_github_link_by_github_user_id(
        &self,
        github_user_id: &str,
    ) -> impl Future<Output = Result<GithubLink, Self::Err>> + Send;

    /// Counts the number of github links for the given github user id
    fn count_github_links_by_github_user_id(
        &self,
        github_user_id: &str,
    ) -> impl Future<Output = Result<i64, Self::Err>> + Send;

    /// Gets the github link by id
    fn get_github_link_by_id(
        &self,
        id: &uuid::Uuid,
    ) -> impl Future<Output = Result<GithubLink, Self::Err>> + Send;

    /// Inserts a github link
    fn insert_github_link(
        &self,
        link: &GithubLink,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// deletes the in progress user link
    fn delete_in_progress_user_link(
        &self,
        in_progress_link_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Deletes the github link from the repo
    fn delete_github_link(
        &self,
        link_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Repository for handling github oauth related actions.
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait GithubOauth: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: Into<anyhow::Error> + Send + std::fmt::Debug;

    /// Constructs the oauth url to authenticate with github.
    ///
    /// `state` is the opaque, already-encoded value the callback expects
    /// back; it is placed in the URL as-is.
    fn construct_oauth_url(
        &self,
        client_id: &str,
        redirect_uri: &str,
        state: &str,
    ) -> Result<String, Self::Err>;

    /// Exchanges the oauth code for tokens
    fn exchange_oauth_code_for_tokens(
        &self,
        client_id: &str,
        client_secret: &str,
        redirect_uri: &str,
        code: &str,
    ) -> impl Future<Output = Result<GithubExchangeTokenResponse, Self::Err>> + Send;

    /// Gets the user info using the access token
    fn get_user_info(
        &self,
        access_token: &str,
    ) -> impl Future<Output = Result<GithubUserInfo, Self::Err>> + Send;

    /// Checks if the access token is expired or invalid.
    fn is_access_token_expired(
        &self,
        access_token: &str,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Gets pull request details using the user's access token.
    fn get_pull_request_details(
        &self,
        access_token: &str,
        owner: &str,
        repo: &str,
        number: u64,
    ) -> impl Future<Output = Result<GithubPullRequestDetails, Self::Err>> + Send;

    /// Reads which merge methods a repository allows, as the user sees it.
    fn get_repository_merge_settings(
        &self,
        access_token: &str,
        owner: &str,
        repo: &str,
    ) -> impl Future<Output = Result<GithubRepositoryMergeSettings, Self::Err>> + Send;

    /// Merges a pull request as the user.
    ///
    /// GitHub declining the merge is a [`GithubMergeOutcome::Rejected`]
    /// value, not an error: the request reached GitHub and was answered.
    fn merge_pull_request(
        &self,
        access_token: &str,
        owner: &str,
        repo: &str,
        number: u64,
        merge_method: GithubMergeMethod,
    ) -> impl Future<Output = Result<GithubMergeOutcome, Self::Err>> + Send;

    /// Enables auto-merge on a pull request as the user.
    ///
    /// GitHub declining the request is a [`GithubAutoMergeOutcome::Rejected`]
    /// value, not an error: the request reached GitHub and was answered.
    fn enable_auto_merge(
        &self,
        access_token: &str,
        owner: &str,
        repo: &str,
        number: u64,
        merge_method: GithubMergeMethod,
    ) -> impl Future<Output = Result<GithubAutoMergeOutcome, Self::Err>> + Send;
}

/// Repository for handling auth related actions.
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait Auth: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: Into<anyhow::Error> + Send + std::fmt::Debug;

    /// Links the github account to the auth user
    fn link_user(
        &self,
        fusionauth_user_id: &uuid::Uuid,
        idp_id: &str,
        github_user_id: &str,
        username: &str,
        access_token: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Deletes the github link for a auth user
    fn delete_user_link(
        &self,
        github_link: &GithubLink,
        github_idp_id: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Retreives the users github access token
    fn retreive_access_token(
        &self,
        fusionauth_user_id: &uuid::Uuid,
        github_idp_id: &str,
    ) -> impl Future<Output = Result<GithubAccessToken, Self::Err>> + Send;
}

/// Service interface for github link operations (OAuth and account linking).
///
/// Handles OAuth URL construction and user account linking.
pub trait GithubLinkService: Send + Sync + 'static {
    /// Constructs the oauth url to authenticate with github.
    ///
    /// `state` is the opaque, already-encoded value the callback expects
    /// back; it is placed in the URL as-is.
    fn construct_oauth_url(&self, redirect_uri: &str, state: &str) -> Result<String, GithubError>;

    /// Uses token exchange to link the user to the github account
    fn link_user(
        &self,
        user_id: &MacroUserId<Lowercase<'static>>,
        fusionauth_user_id: &uuid::Uuid,
        in_progress_user_link: &uuid::Uuid,
        redirect_uri: &str,
        code: &str,
    ) -> impl Future<Output = Result<GithubLink, GithubError>> + Send;

    /// Gets a users github link
    fn get_user_link(
        &self,
        user_id: &MacroUserId<Lowercase<'static>>,
    ) -> impl Future<Output = Result<GithubLink, GithubError>> + Send;

    /// Deletes the link for the user
    fn delete_user_link(
        &self,
        user_id: &MacroUserId<Lowercase<'static>>,
    ) -> impl Future<Output = Result<(), GithubError>> + Send;

    /// Checks whether the user's Github link token is valid.
    fn check_user_link_token(
        &self,
        user_id: &MacroUserId<Lowercase<'static>>,
    ) -> impl Future<Output = Result<(), GithubError>> + Send;

    /// Enriches GitHub pull request references with details from the GitHub API.
    fn enrich_pull_requests(
        &self,
        user_id: &MacroUserId<Lowercase<'static>>,
        pull_requests: Vec<GithubPullRequestRef>,
    ) -> impl Future<Output = Result<Vec<EnrichedGithubPullRequest>, GithubError>> + Send;

    /// Merges a pull request as the user, with their own GitHub grant, so
    /// GitHub applies the user's permissions and branch protections.
    ///
    /// A merge GitHub declines is
    /// [`GithubError::PullRequestMergeRejected`] with GitHub's message.
    fn merge_pull_request(
        &self,
        user_id: &MacroUserId<Lowercase<'static>>,
        request: MergeGithubPullRequestRequest,
    ) -> impl Future<Output = Result<MergeGithubPullRequestResponse, GithubError>> + Send;

    /// Enables auto-merge on a pull request as the user, with their own GitHub
    /// grant. GitHub applies the user's permissions and repository settings.
    ///
    /// An enable-auto-merge GitHub declines is
    /// [`GithubError::AutoMergeRejected`] with GitHub's message.
    fn enable_auto_merge(
        &self,
        user_id: &MacroUserId<Lowercase<'static>>,
        request: EnableAutoMergeRequest,
    ) -> impl Future<Output = Result<EnableAutoMergeResponse, GithubError>> + Send;
}
