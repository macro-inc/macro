//! Configuration for the agent egress service, loaded via the standard
//! `macro_config` pattern so it gets a `doppler_config` validation binary.
//!
//! Required env vars are declared here as typed fields. The `doppler_config`
//! binary loads this `Config` from Doppler for both the dev and prod
//! environments, surfacing any missing or mistyped values at CI time.

use anyhow::Context;
use database_env_vars::DatabaseUrl;
pub use macro_env::Environment;
use secretsmanager_client::LocalOrRemoteSecret;

macro_env_var::env_vars!(
    /// PEM private key of the GitHub App installation tokens are minted with.
    pub struct GithubSyncAppPemSecretKey;
    /// RSA key Macro API tokens are signed with - the same one
    /// `authentication_service` signs with. This proxy mints short-lived
    /// tokens for session owners inline.
    pub struct MacroApiTokenPrivateSecretKey;
    /// Issuer stamped into minted Macro API tokens; must match what the
    /// validators expect.
    pub struct MacroApiTokenIssuer;
    /// OAuth client ID for the Pipedream API. The same credentials
    /// `document_cognition_service` uses: the connections a sandbox spends
    /// are the ones the person connected in Macro, in the same rows.
    pub struct PipedreamClientId;
    /// OAuth client secret for the Pipedream API.
    pub struct PipedreamClientSecret;
    /// The Pipedream Connect project ID (`proj_...`).
    pub struct PipedreamProjectId;
);

/// The Pipedream project environment matching this deployment: production in
/// prd, development everywhere else.
fn default_pipedream_environment() -> String {
    match Environment::new_or_prod() {
        Environment::Production => "production".to_owned(),
        _ => "development".to_owned(),
    }
}

/// The configuration parameters for the agent egress service.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// The environment we are in.
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,
    /// MacroDB connection string. Read-only as far as this service is
    /// concerned: session rows to verify a token against, the owner's
    /// Pipedream connections, and the GitHub App installation rows.
    pub database_url: DatabaseUrl,
    /// Port the sandbox-facing proxy is served on.
    ///
    /// Its only client is a sandbox, and its only credential is a session
    /// token read from `Authorization`.
    #[macro_config_default(8102)]
    pub port: u16,
    /// OAuth client ID for the Pipedream API.
    pub pipedream_client_id: PipedreamClientId,
    /// OAuth client secret for the Pipedream API.
    pub pipedream_client_secret: PipedreamClientSecret,
    /// The Pipedream Connect project ID.
    pub pipedream_project_id: PipedreamProjectId,
    /// The Pipedream project environment (`development` or `production`).
    #[macro_config_default(default_pipedream_environment())]
    pub pipedream_environment: String,
    /// Base URL of the Pipedream API.
    #[macro_config_default(String::from(pipedream_mcp::outbound::api::DEFAULT_API_URL))]
    pub pipedream_api_url: String,
    /// URL of Pipedream's remote MCP server.
    #[macro_config_default(String::from(pipedream_mcp::outbound::api::DEFAULT_MCP_URL))]
    pub pipedream_mcp_url: String,
    /// RSA key Macro API tokens are signed with.
    pub macro_api_token_private_secret_key: LocalOrRemoteSecret<MacroApiTokenPrivateSecretKey>,
    /// Issuer stamped into minted Macro API tokens.
    pub macro_api_token_issuer: MacroApiTokenIssuer,
    /// Client id of the GitHub App installation tokens are minted for.
    pub github_sync_app_client_id: String,
    /// PEM private key of that App.
    pub github_sync_app_pem_secret_key: LocalOrRemoteSecret<GithubSyncAppPemSecretKey>,
}

impl Config {
    /// Load the configuration from the environment.
    pub fn from_env() -> anyhow::Result<Self> {
        macro_config::ConfigLoader::load::<Config>()
            .context("failed to load agent egress service config")
    }
}
