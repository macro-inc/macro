//! Shared JSON bodies for Macro Connect's customer-facing routes.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use zeroize::Zeroize as _;

/// An app available in Connect's catalog.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CatalogEntry {
    /// Stable app identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Short capabilities description.
    pub description: String,
    /// Access methods, such as `mcp`.
    pub access: Vec<String>,
    /// Vendor-owned MCP server URL.
    pub mcp_url: String,
    /// Connect-served icon path when an official SVG is available.
    pub icon_url: Option<String>,
}

/// Body for creating a browser connect session.
#[derive(Debug, Deserialize, Serialize, ToSchema)]
pub struct ConnectSessionRequest {
    /// Customer's user identifier.
    #[serde(alias = "externalUserId")]
    pub external_user_id: String,
    /// App to connect.
    #[serde(alias = "appId")]
    pub app_id: String,
    /// Customer callback URL.
    #[serde(alias = "redirectUrl")]
    pub redirect_url: String,
}

/// URL and expiration of a browser connect session.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ConnectSessionResponse {
    /// URL for the user's browser to visit.
    pub connect_url: String,
    /// Session expiration.
    pub expires_at: DateTime<Utc>,
}

/// One of a customer's user connections.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    /// Stable app identifier.
    pub app_id: String,
    /// Whether the grant can be used.
    pub status: ConnectionStatus,
    /// Granted OAuth scopes.
    pub scopes: Vec<String>,
    /// Creation time.
    pub created_at: DateTime<Utc>,
}

/// Filters and paging for a customer's connections.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct ConnectionsQuery {
    /// Page size; defaults to 100 and cannot exceed 500.
    pub limit: Option<u16>,
    /// Opaque cursor from a prior page.
    pub cursor: Option<String>,
    /// Restrict results to an app.
    pub app_id: Option<String>,
    /// Restrict results to a connection status.
    pub status: Option<ConnectionStatus>,
}

/// A connection and its owning customer's opaque user identifier.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListedConnection {
    /// Customer-provided user identifier.
    pub external_user_id: String,
    /// Stable app identifier.
    pub app_id: String,
    /// Current usability.
    pub status: ConnectionStatus,
    /// Granted OAuth scopes.
    pub scopes: Vec<String>,
    /// Creation time.
    pub created_at: DateTime<Utc>,
    /// Last connection update.
    pub updated_at: DateTime<Utc>,
    /// Access token expiration, when known.
    pub access_token_expires_at: Option<DateTime<Utc>>,
}

/// One page of customer connections.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionsPage {
    /// Connections in descending creation order.
    pub items: Vec<ListedConnection>,
    /// Opaque position for the next page, or null when complete.
    pub next_cursor: Option<String>,
}

/// Filters and paging for a customer's connected users.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct UsersQuery {
    /// Number of users per page; defaults to 100 and cannot exceed 500.
    pub limit: Option<u16>,
    /// Opaque cursor from a prior page.
    pub cursor: Option<String>,
    /// Select users with a matching app connection.
    pub app_id: Option<String>,
    /// Select users with a matching connection status.
    pub status: Option<ConnectionStatus>,
}

/// A customer user and all of their connections.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListedUser {
    /// Customer-provided user identifier.
    pub external_user_id: String,
    /// Creation time of the user's first connection.
    pub first_connected_at: DateTime<Utc>,
    /// Every connection of the user, ordered by app ID.
    pub connections: Vec<ListedConnection>,
}

/// One page of connected users.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UsersPage {
    /// Users ordered by first connection time, newest first, then user ID descending.
    pub items: Vec<ListedUser>,
    /// Opaque position for the next page, or null when complete.
    pub next_cursor: Option<String>,
}

/// Connection counts for one catalog app.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AppConnectionsSummary {
    /// Stable app identifier.
    pub app_id: String,
    /// Usable connections.
    pub active: u64,
    /// Connections requiring new consent.
    pub needs_reauth: u64,
}

/// Counts for a customer and each app with connections.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionsSummary {
    /// Distinct users with at least one connection.
    pub users: u64,
    /// Total connections.
    pub connections: u64,
    /// Connections requiring new consent.
    pub needs_reauth: u64,
    /// Counts by app; apps with no connections are omitted.
    pub apps: Vec<AppConnectionsSummary>,
}

/// Current usability of a connection.
#[derive(
    Clone, Copy, Debug, Deserialize, Serialize, ToSchema, strum::EnumString, strum::Display,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ConnectionStatus {
    /// Grant is available.
    Active,
    /// User must grant access again.
    NeedsReauth,
}

/// Result of deleting a connection locally.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResponse {
    /// Always false: deleting locally does not revoke the vendor grant.
    pub vendor_grant_revoked: bool,
}

/// An exported OAuth access token.
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TokenResponse {
    /// Bearer token for the vendor API.
    pub access_token: String,
    /// Expiration, when supplied by the vendor.
    pub expires_at: Option<DateTime<Utc>>,
}

impl std::fmt::Debug for TokenResponse {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TokenResponse")
            .field("access_token", &"[REDACTED]")
            .field("expires_at", &self.expires_at)
            .finish()
    }
}

impl Drop for TokenResponse {
    fn drop(&mut self) {
        self.access_token.zeroize();
    }
}

/// Connect API error body.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ErrorResponse {
    /// Stable machine-readable error code.
    pub error: String,
}

/// MCP gateway error body.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct McpErrorResponse {
    /// Stable machine-readable error code.
    pub error: String,
    /// App for which the request failed.
    pub app_id: String,
}
