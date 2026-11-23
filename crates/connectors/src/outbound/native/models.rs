//! The native source's rows and settings.

mod aes_key;
mod oauth_client_metadata;
mod server;

pub use aes_key::AesKey;
pub(crate) use macro_user_id::user_id::MacroUserIdStr;
pub(crate) use mcp_toolset::McpServer;
pub use oauth_client_metadata::OAuthClientMetadata;
pub(crate) use rmcp::transport::auth::StoredCredentials;
pub(crate) use server::{McpServerRecord, dial_with_bearer};

/// GitHub's hosted MCP server. A user's Macro GitHub account link authorizes
/// it; see [`crate::outbound::github_link`].
pub(crate) const GITHUB_MCP_SERVER_URL: &str = "https://api.githubcopilot.com/mcp";
