//! Domain models for github link operations (OAuth and account linking).

use macro_user_id::user_id::MacroUserIdStr;
use serde::Deserialize;

/// Github access token
#[derive(Clone)]
#[allow(dead_code)]
pub struct GithubAccessToken(String);

impl GithubAccessToken {
    /// Creates a new GithubAccessToken
    pub fn new(token: String) -> Self {
        Self(token)
    }

    /// Returns the token string without exposing ownership of the secret.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl AsRef<str> for GithubAccessToken {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
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
