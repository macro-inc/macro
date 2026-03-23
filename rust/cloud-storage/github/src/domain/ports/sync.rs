//! Port definitions for github sync operations (webhooks and sync app).

use std::future::Future;

use crate::domain::models::{
    GithubError, GithubInstallationAccessToken, GithubKey, MacroTaskId, ValidatedGithubWebhookEvent,
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

    /// Looks up the macro user ID associated with a GitHub user ID via the `github_links` table.
    /// Returns `None` if no link exists.
    fn get_macro_id_by_github_user_id(
        &self,
        github_user_id: &str,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;

    /// Returns all team IDs the given macro user belongs to.
    fn get_user_team_ids(
        &self,
        macro_id: &str,
    ) -> impl Future<Output = Result<Vec<uuid::Uuid>, Self::Err>> + Send;

    /// Inserts associations between a GitHub App installation and the given teams.
    /// Ignores conflicts (idempotent).
    fn insert_installation_team_associations(
        &self,
        installation_id: &str,
        team_ids: &[uuid::Uuid],
        installed_by: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
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

    /// Generates an installation access token for the github sync app
    fn generate_installation_access_token(
        &self,
        installation_id: u64,
    ) -> impl Future<Output = Result<GithubInstallationAccessToken, GithubError>> + Send;
}
