//! Port definitions for the github domain.
//!
//! These traits define the contracts that adapters must implement.

use std::future::Future;

use crate::domain::models::{
    GithubAccessToken, GithubError, GithubExchangeTokenResponse, GithubInstallationAccessToken,
    GithubUserInfo, ValidatedGithubWebhookEvent,
};

use super::models::GithubLink;
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
}

/// Repository for handling github oauth related actions.
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait GithubOauth: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: Into<anyhow::Error> + Send + std::fmt::Debug;

    /// Constructs the oauth url to authenticate with github
    fn construct_oauth_url<T: serde::Serialize + std::fmt::Debug + 'static>(
        &self,
        client_id: &str,
        redirect_uri: &str,
        state: T,
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

    /// Retreives the users github access token
    fn retreive_access_token(
        &self,
        fusionauth_user_id: &uuid::Uuid,
        github_idp_id: &str,
    ) -> impl Future<Output = Result<GithubAccessToken, Self::Err>>;
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

/// Service interface for github link operations (OAuth and account linking).
///
/// Handles OAuth URL construction and user account linking.
pub trait GithubLinkService: Send + Sync + 'static {
    /// Constructs the oauth url to authenticate with github
    fn construct_oauth_url<T: serde::Serialize + std::fmt::Debug + 'static>(
        &self,
        redirect_uri: &str,
        state: T,
    ) -> Result<String, GithubError>;

    /// Uses token exchange to link the user to the github account
    fn link_user(
        &self,
        user_id: &MacroUserId<Lowercase<'static>>,
        fusionauth_user_id: &uuid::Uuid,
        in_progress_user_link: &uuid::Uuid,
        redirect_uri: &str,
        code: &str,
    ) -> impl Future<Output = Result<GithubLink, GithubError>> + Send;
}
