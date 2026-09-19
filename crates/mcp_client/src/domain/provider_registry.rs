//! Some providers don't support dynamic client registration.
//! They are configured on a per-provider basis and config loaded here
use super::models;

/// Slack MCP server URL.
const SLACK_SERVER_URL: &str = "https://mcp.slack.com/mcp";
const GITHUB_SERVER_URL: &str = "https://api.githubcopilot.com/mcp";
const LINEAR_SERVER_URL: &str = "https://mcp.linear.app/mcp";

macro_env_var::env_var! {
    /// Environment variables for pre-registered MCP providers.
    #[allow(missing_docs)]
    pub struct ProviderEnvVars {
        /// Slack MCP OAuth client ID (`SLACK_MCP_CLIENT_ID`).
        pub SlackMcpClientId,
        /// Slack MCP OAuth client secret (`SLACK_MCP_CLIENT_SECRET`).
        pub SlackMcpClientSecret,
        /// GitHub OAuth client ID (`GITHUB_CLIENT_ID`).
        pub GithubClientId,
        /// GitHub OAuth client secret (`GITHUB_CLIENT_SECRET`).
        pub GithubClientSecret,
    }
}

fn slack_scopes() -> Vec<String> {
    let manifest: serde_json::Value =
        serde_json::from_str(include_str!("provider_registry/slack/manifest.json"))
            .expect("valid slack manifest");
    manifest["oauth_config"]["scopes"]["user"]
        .as_array()
        .expect("manifest missing oauth_config.scopes.user")
        .iter()
        .map(|v| v.as_str().expect("scope must be a string").to_owned())
        .collect()
}

/// Pre-registered OAuth credentials for an MCP server that doesn't support DCR.
#[derive(Clone, Debug)]
pub struct PreRegisteredCredentials {
    /// OAuth client ID.
    pub client_id: String,
    /// OAuth client secret.
    pub client_secret: String,
    /// Scopes to request during authorization.
    pub scopes: Vec<String>,
}

/// Registry of MCP servers with pre-registered OAuth credentials.
///
/// Servers in this registry skip Dynamic Client Registration and use the
/// stored credentials directly.
pub struct PreRegisteredProviders {
    env: Option<ProviderEnvVars>,
}

impl PreRegisteredProviders {
    /// Build the registry from environment variables.
    pub fn from_env() -> models::Result<Self> {
        ProviderEnvVars::new()
            .map_err(models::Error::RequiredEnvironmentVariable)
            .map(|env| Self { env: Some(env) })
    }

    /// Build an empty registry for callers that do not need provider OAuth.
    pub fn empty() -> Self {
        Self { env: None }
    }

    /// Look up pre-registered credentials for a server URL.
    ///
    /// A trailing slash does not change which server a URL names, and these
    /// providers are exactly the ones that cannot register a client on the
    /// fly: missing the match sends the flow to DCR, which they refuse, so
    /// `https://api.githubcopilot.com/mcp/` would fail with "Dynamic client
    /// registration not supported" while `.../mcp` connected fine.
    pub fn get(&self, server_url: &str) -> Option<PreRegisteredCredentials> {
        let env = self.env.as_ref()?;
        match server_url.trim_end_matches('/') {
            SLACK_SERVER_URL => Some(PreRegisteredCredentials {
                client_id: env.slack_mcp_client_id.to_string(),
                client_secret: env.slack_mcp_client_secret.to_string(),
                scopes: slack_scopes(),
            }),
            GITHUB_SERVER_URL => Some(PreRegisteredCredentials {
                client_id: env.github_client_id.to_string(),
                client_secret: env.github_client_secret.to_string(),
                scopes: vec![],
            }),
            _ => None,
        }
    }
}

/// Default OAuth scopes to request for MCP servers that support Dynamic
/// Client Registration but have no pre-registered credentials.
///
/// Requesting no scope isn't the same as requesting "default" access on
/// every provider: Linear's MCP authorization server records the local
/// approval with whatever scope was requested (empty, if none was) but then
/// defaults the actual grant it asks the user for to full write access,
/// leaving the recorded approval and the granted access out of sync and the
/// flow failing after the user approves. Requesting explicit scopes keeps
/// both sides consistent.
///
/// Trailing slash insensitive, on the same grounds as
/// [`PreRegisteredProviders::get`]: it does not change which server the URL
/// names, and missing the match here is what leaves the recorded approval and
/// the granted access out of sync.
pub fn dcr_default_scopes(server_url: &str) -> Vec<String> {
    match server_url.trim_end_matches('/') {
        LINEAR_SERVER_URL => vec!["read".to_string(), "write".to_string()],
        _ => vec![],
    }
}

#[cfg(test)]
mod test;
