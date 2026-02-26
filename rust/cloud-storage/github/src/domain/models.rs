//! Domain models for the github crate.

use macro_user_id::user_id::MacroUserIdStr;
use serde::Deserialize;

/// Errors that can occur during github operations.
#[derive(Debug, thiserror::Error)]
pub enum GithubError {
    /// An internal error occurred.
    #[error("{0}")]
    Internal(#[from] anyhow::Error),
    /// No Github link was found
    #[error("no link found")]
    NoLinkFound,
    /// Github account is already linked
    #[error("github account is already linked with another")]
    AccountAlreadyLinked,
    /// No refresh token was provided in the token exchange
    #[error("no refresh token provided in token exchange")]
    NoRefreshTokenProvided,
}

/// A GitHub link record (as stored in the database)
#[derive(Debug, Clone)]
pub struct GithubLink {
    /// Unique ID for this link
    pub id: uuid::Uuid,
    /// Macro user ID
    pub macro_id: MacroUserIdStr<'static>,
    /// FusionAuth user ID
    pub fusionauth_user_id: uuid::Uuid,
    /// GitHub username
    pub github_username: String,
    /// GitHub user ID (as string)
    pub github_user_id: String,
    /// When the link was created
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// When the link was last updated
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

/// GitHub OAuth token exchange response
#[derive(Debug, Deserialize)]
pub struct GithubExchangeTokenResponse {
    /// The access token for Github API calls
    pub access_token: String,
    /// The type of token (usually "bearer")
    pub token_type: String,
    /// The scopes granted to this token
    pub scope: String,
    /// The refresh token (only present if token expiration is enabled in Github App settings)
    pub refresh_token: Option<String>,
    /// Seconds until access token expires (only present if token expiration is enabled)
    pub expires_in: Option<i64>,
    /// Seconds until refresh token expires (only present if token expiration is enabled)
    pub refresh_token_expires_in: Option<i64>,
}

/// Github user information retrieved from Github API
#[derive(Debug, Deserialize)]
pub struct GithubUserInfo {
    /// Github user ID (numeric)
    pub id: u64,
    /// Github username
    pub login: String,
    /// Primary email (may be null if private)
    pub email: Option<String>,
    /// Display name
    pub name: Option<String>,
}
