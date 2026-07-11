//! Port definitions for github sync operations (webhooks and sync app).

use std::future::Future;

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::models::{
    EnrichedGithubPullRequest, GithubAppInstallationSource, GithubError,
    GithubInstallationAccessToken, GithubKey, GithubPullRequestDetails, MacroTaskId,
    TeamTaskReference, ValidatedGithubWebhookEvent,
};

/// Repository for accessing github sync data from the database.
///
/// All methods perform database operations — SQL queries are written
/// directly in the outbound adapter implementation.
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait GithubSyncRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: Into<anyhow::Error> + Send + std::fmt::Debug;

    /// Provides a list of all task ids for a given github key
    fn get_task_ids(
        &self,
        github_key: GithubKey,
    ) -> impl Future<Output = Result<Vec<MacroTaskId>, Self::Err>> + Send;

    /// Upserts task ids for a given github key
    fn upsert_task_ids(
        &self,
        github_key: GithubKey,
        task_ids: &[MacroTaskId],
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Filters out all pre-existing tasks for the github key
    /// Returns only new task ids
    fn filter_duplicate_tasks(
        &self,
        github_key: GithubKey,
        task_ids: &[MacroTaskId],
    ) -> impl Future<Output = Result<Vec<MacroTaskId>, Self::Err>> + Send;

    /// Resolves team-scoped task references for a GitHub App installation.
    ///
    /// Implementations should use the installation's team sources from
    /// `github_app_installation` (`source_type = 'team'`) and the referenced
    /// team slug/task number to find the backing Macro task document.
    fn resolve_team_task_references(
        &self,
        installation_id: &str,
        references: &[TeamTaskReference],
    ) -> impl Future<Output = Result<Vec<MacroTaskId>, Self::Err>> + Send;

    /// Maps GitHub user IDs to the Macro user IDs linked to them via the `github_links` table.
    ///
    /// A GitHub user ID absent from the result has no link; a GitHub user ID may map to
    /// multiple Macro users because `github_links.github_user_id` is not unique (many Macro
    /// users may share one GitHub account).
    fn get_macro_ids_by_github_user_ids(
        &self,
        github_user_ids: &[String],
    ) -> impl Future<Output = Result<std::collections::HashMap<String, Vec<String>>, Self::Err>> + Send;

    /// Maps GitHub logins to the Macro user IDs linked to them via the `github_links` table.
    ///
    /// Logins are matched case-insensitively and returned lowercased. A login absent
    /// from the result has no link; a login may map to multiple Macro users because
    /// `github_links.github_username` is not unique.
    fn get_macro_ids_by_github_logins(
        &self,
        github_logins: &[String],
    ) -> impl Future<Output = Result<std::collections::HashMap<String, Vec<String>>, Self::Err>> + Send;

    /// Returns all team IDs the given macro user belongs to.
    fn get_user_team_ids(
        &self,
        macro_id: &str,
    ) -> impl Future<Output = Result<Vec<uuid::Uuid>, Self::Err>> + Send;

    /// Returns the Macro sources associated with a GitHub App installation.
    fn get_installation_sources(
        &self,
        installation_id: &str,
    ) -> impl Future<Output = Result<Vec<GithubAppInstallationSource>, Self::Err>> + Send;

    /// Returns all Macro user IDs that belong to the given team.
    fn get_team_member_ids(
        &self,
        team_id: uuid::Uuid,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, Self::Err>> + Send;

    /// Upserts associations between a GitHub App installation and its sources.
    /// Ignores conflicts (idempotent).
    fn upsert_installation_sources(
        &self,
        installation_id: &str,
        sources: &[GithubAppInstallationSource],
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Records the GitHub user that installed a GitHub App installation,
    /// replacing any previously recorded installer for the installation.
    fn upsert_installation_installer(
        &self,
        installation_id: &str,
        github_user_id: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Returns the installation IDs installed by the given GitHub user.
    fn get_installation_ids_by_installer(
        &self,
        github_user_id: &str,
    ) -> impl Future<Output = Result<Vec<String>, Self::Err>> + Send;
}

/// Client interface for making GitHub sync API calls.
///
/// Abstracts HTTP communication with GitHub's API so the service
/// layer does not need to manage its own HTTP client.
pub trait GithubSyncClient: Send + Sync + 'static {
    /// Generates an installation access token for a given GitHub App installation.
    fn generate_installation_access_token(
        &self,
        jwt: &str,
        installation_id: u64,
    ) -> impl Future<Output = Result<GithubInstallationAccessToken, GithubError>> + Send;

    /// Posts a comment on a GitHub pull request (via the issues API).
    fn create_pr_comment(
        &self,
        access_token: &str,
        owner: &str,
        repo: &str,
        pull_number: u64,
        body: &str,
    ) -> impl Future<Output = Result<(), GithubError>> + Send;

    /// Fetches enriched pull request details using a GitHub App installation token.
    fn get_pull_request_details(
        &self,
        access_token: &str,
        owner: &str,
        repo: &str,
        number: u64,
    ) -> impl Future<Output = Result<GithubPullRequestDetails, GithubError>> + Send;

    /// Lists open pull requests for repositories accessible to a GitHub App installation token.
    fn list_open_pull_requests(
        &self,
        access_token: &str,
    ) -> impl Future<Output = Result<Vec<EnrichedGithubPullRequest>, GithubError>> + Send;
}

/// Service interface for github sync operations (webhooks and sync app).
///
/// Handles webhook validation/processing and sync app installation token generation.
pub trait GithubSyncService: Send + Sync + 'static {
    /// Validates the incoming webhook event and returns back the `ValidatedGithubWebhookEvent`
    fn validate_webhook_event(
        &self,
        event_type: &str,
        signature: &str,
        body: &[u8],
    ) -> impl Future<Output = Result<ValidatedGithubWebhookEvent, GithubError>> + Send;

    /// Processes and incoming github webhook event
    fn process_webhook_event(
        &self,
        webhook_event: &ValidatedGithubWebhookEvent,
    ) -> impl Future<Output = Result<(), GithubError>> + Send;

    /// Returns the github sync app installation url
    fn get_github_sync_app_url(&self) -> &str;

    /// Associates any GitHub App installations installed by the given GitHub
    /// user with that user's Macro sources (teams or user), then backfills
    /// open pull requests for newly associated installations.
    ///
    /// Intended to be called when a `github_links` row is created after the
    /// app was installed, since the installation webhook could not resolve a
    /// Macro user at install time.
    fn associate_installations_for_github_user(
        &self,
        github_user_id: &str,
    ) -> impl Future<Output = Result<(), GithubError>> + Send;

    /// Generates an installation access token for the github sync app
    fn generate_installation_access_token(
        &self,
        installation_id: u64,
    ) -> impl Future<Output = Result<GithubInstallationAccessToken, GithubError>> + Send;
}
