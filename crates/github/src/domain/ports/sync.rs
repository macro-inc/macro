//! Port definitions for github sync operations (webhooks and sync app).

use std::future::Future;

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::models::{
    AppJwt, EnrichedGithubPullRequest, GithubAppInstallationSource, GithubAuthenticatedUser,
    GithubError, GithubInstallationAccessToken, GithubKey, GithubPullRequestDetails,
    GithubSetupAccessToken, GithubUserInstallation, MacroTaskId, ResolvedTeamTaskReference,
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
    /// team slug/task number to find the backing Macro task document. Each
    /// match is returned with the team it resolved in; because team slugs are
    /// not unique, one reference may resolve in several of the installation's
    /// teams and callers must treat such references as ambiguous instead of
    /// linking every match.
    fn resolve_team_task_references(
        &self,
        installation_id: &str,
        references: &[TeamTaskReference],
    ) -> impl Future<Output = Result<Vec<ResolvedTeamTaskReference>, Self::Err>> + Send;

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

    /// Deletes all source associations for a GitHub App installation.
    /// Deleting an installation with no associations is a no-op (idempotent).
    fn delete_installation_sources(
        &self,
        installation_id: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Records the Macro source a GitHub user asked to sync when requesting an
    /// org install that awaits admin approval. Replaces any earlier pending
    /// request by the same GitHub user (latest intent wins).
    fn upsert_installation_request(
        &self,
        github_user_id: &str,
        source: &GithubAppInstallationSource,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Returns the pending installation request source for a GitHub user, if any.
    fn get_installation_request(
        &self,
        github_user_id: &str,
    ) -> impl Future<Output = Result<Option<GithubAppInstallationSource>, Self::Err>> + Send;

    /// Deletes a GitHub user's pending installation request.
    /// Deleting a missing request is a no-op (idempotent).
    fn delete_installation_request(
        &self,
        github_user_id: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Client interface for making GitHub sync API calls.
///
/// Abstracts HTTP communication with GitHub's API so the service
/// layer does not need to manage its own HTTP client.
pub trait GithubSyncClient: Send + Sync + 'static {
    /// Exchanges a GitHub App setup callback code for a user access token.
    fn exchange_setup_code(
        &self,
        client_id: &str,
        client_secret: &str,
        code: &str,
    ) -> impl Future<Output = Result<GithubSetupAccessToken, GithubError>> + Send;

    /// Lists every GitHub App installation visible to a user access token.
    fn list_user_installations(
        &self,
        access_token: &str,
    ) -> impl Future<Output = Result<Vec<GithubUserInstallation>, GithubError>> + Send;

    /// Fetches the GitHub user behind a user access token.
    fn get_authenticated_user(
        &self,
        access_token: &str,
    ) -> impl Future<Output = Result<GithubAuthenticatedUser, GithubError>> + Send;

    /// Generates an installation access token for a given GitHub App installation.
    fn generate_installation_access_token(
        &self,
        jwt: &AppJwt,
        installation_id: u64,
    ) -> impl Future<Output = Result<GithubInstallationAccessToken, GithubError>> + Send;

    /// Finds which installation of our App covers a repository, if any.
    ///
    /// `None` means the App is not installed on it - which, from a caller
    /// acting for a user, is indistinguishable from a repository that does not
    /// exist, and deliberately so.
    fn get_repository_installation(
        &self,
        jwt: &AppJwt,
        owner: &str,
        repository: &str,
    ) -> impl Future<Output = Result<Option<u64>, GithubError>> + Send;

    /// Generates an installation access token cut down to one repository and a
    /// named set of permissions.
    ///
    /// An unscoped installation token reaches every repository in the
    /// installation with every permission it was granted; this is the narrow
    /// form, for callers acting on one repository's behalf. `permissions` are
    /// GitHub's own names and levels, e.g. `("contents", "write")`.
    fn generate_scoped_installation_access_token(
        &self,
        jwt: &AppJwt,
        installation_id: u64,
        repository: &str,
        permissions: &[(&str, &str)],
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

    /// Begins an authenticated GitHub App installation setup flow.
    fn begin_installation_setup(
        &self,
        _macro_user_id: &MacroUserIdStr<'_>,
        _team_id: Option<uuid::Uuid>,
    ) -> impl Future<Output = Result<String, GithubError>> + Send {
        async {
            Err(GithubError::Internal(anyhow::anyhow!(
                "installation setup is unsupported"
            )))
        }
    }

    /// Completes an installation setup callback after verifying its state,
    /// that the completing GitHub account is linked to the state's Macro user,
    /// and (for install/update) that the account owns the installation.
    fn complete_installation_setup(
        &self,
        _state: &str,
        _code: Option<&str>,
        _installation_id: Option<u64>,
        _setup_action: &str,
    ) -> impl Future<Output = Result<(), GithubError>> + Send {
        async {
            Err(GithubError::Internal(anyhow::anyhow!(
                "installation setup is unsupported"
            )))
        }
    }

    /// Returns the raw installation URL for legacy inbound adapters.
    ///
    /// New installation flows must use [`GithubSyncService::begin_installation_setup`].
    fn get_github_sync_app_url(&self) -> &str;

    /// Generates an installation access token for the github sync app
    fn generate_installation_access_token(
        &self,
        installation_id: u64,
    ) -> impl Future<Output = Result<GithubInstallationAccessToken, GithubError>> + Send;
}
