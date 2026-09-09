#![recursion_limit = "256"]
//! Composition root for the agent egress service.
//!
//! The hexagon lives in `crates/agent_egress`; this binary is the shell
//! around it: the Postgres repositories that say whose session a token is and
//! which apps its owner connected, the credential minters for Macro's own MCP
//! server and for GitHub App installations, and the listener a sandbox dials.
//!
//! It runs apart from the harness on purpose. The harness mints session
//! tokens and advertises the URLs; this process is the only one holding the
//! upstream credentials those URLs resolve to, and nothing here needs Kafka,
//! Redis, a container provider, or an agent runtime.

mod api;
mod config;

#[cfg(test)]
mod test;

use std::sync::Arc;

use agent_egress::domain::service::EgressServiceImpl;
use agent_egress::outbound::forwarder::ReqwestForwarder;
use agent_egress::outbound::github_tokens::GithubAppTokens;
use agent_egress::outbound::macro_mcp::{MacroApiTokenSigner, WithMacroMcp};
use agent_egress::outbound::mcp_credentials::PipedreamMcpCredentials;
use agent_egress::outbound::session_authority::StoredTokenSessionAuthority;
use agent_session::outbound::postgres::PgAgentSessionRepo;
use anyhow::Context as _;
use config::{Config, Environment};
use github::domain::service::{InstallationTokenConfig, InstallationTokenService};
use github::outbound::github_sync_client::GithubSyncClientImpl;
use github::outbound::pg_github_sync_repo::PgGithubSyncRepo;
use macro_entrypoint::{MacroEntrypoint, shutdown_signal};
use macro_service_urls::McpServiceUrl;
use pipedream_mcp::outbound::api::{PipedreamClient, PipedreamConfig};
use pipedream_mcp::outbound::pg_connection_repo::PgConnectionRepo;
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let entrypoint = MacroEntrypoint::default().init();
    let result = run().await;
    entrypoint.shutdown();
    result
}

fn macro_mcp_endpoint(base_url: &McpServiceUrl) -> Result<url::Url, url::ParseError> {
    // Append rather than Url::join("/mcp"), which would discard the gateway prefix.
    url::Url::parse(&format!("{}/mcp", base_url.trim_end_matches('/')))
}

async fn run() -> anyhow::Result<()> {
    // Every upstream this process talks to is TLS: Pipedream, GitHub, and
    // whatever the forwarder is pointed at.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    // AWS first, because the config's secrets resolve through Secrets Manager.
    let aws_config = macro_aws_config::get_macro_aws_config().await;
    let secrets = secretsmanager_client::SecretsManager::new(aws_sdk_secretsmanager::Client::new(
        &aws_config,
    ));
    let config = Config::from_env()?
        .resolve_remote_secrets(Environment::new_or_prod(), &secrets)
        .await
        .context("failed to resolve agent egress service secrets")?;

    let pool = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(5)
        .connect(config.database_url.as_ref())
        .await
        .context("failed to connect to macrodb")?;

    // MCP connections: the same rows the chat tool path reads, so an app
    // connected in Macro is an app the sandbox can reach, with nothing to
    // keep in sync. The rows hold no secrets - Pipedream owns the grants.
    let mcp_connections = Arc::new(PgConnectionRepo::new(pool.clone()));

    // The client that addresses Pipedream's remote MCP server, built from the
    // same credentials `document_cognition_service` uses.
    let pipedream = PipedreamClient::new(PipedreamConfig {
        client_id: config.pipedream_client_id.to_string(),
        client_secret: config.pipedream_client_secret.to_string(),
        project_id: config.pipedream_project_id.to_string(),
        environment: config.pipedream_environment.clone(),
        api_url: config.pipedream_api_url.clone(),
        mcp_url: config.pipedream_mcp_url.clone(),
        // Only Connect tokens carry allowed origins, and this service never
        // mints one: connecting apps stays in the app.
        allowed_origins: Vec::new(),
    })
    .context("failed to build Pipedream client")?;

    // Every session's MCP servers: Macro's own under the reserved `macro`
    // slug, then the owner's Pipedream connections. The `macro` credential is
    // signed inline with the same key authentication_service holds; what this
    // process hands out is always single-user and minutes from expiry.
    let mcp_credentials = WithMacroMcp::new(
        PipedreamMcpCredentials::new(Arc::clone(&mcp_connections), pipedream),
        MacroApiTokenSigner::new(
            pool.clone(),
            config.macro_api_token_issuer.as_ref(),
            config.macro_api_token_private_secret_key.as_ref(),
        ),
        macro_mcp_endpoint(&McpServiceUrl::new()?).context("MCP service endpoint is not a URL")?,
        // The one gate on cleartext: a local stack's mcp-service is dialed
        // across the compose bridge, where TLS would be theater. Everywhere
        // else, an http URL refuses to boot.
        matches!(config.environment, Environment::Local),
    )
    .context("the macro MCP upstream is misconfigured")?;

    let egress = Arc::new(EgressServiceImpl::new(
        StoredTokenSessionAuthority::new(PgAgentSessionRepo::new(pool.clone())),
        mcp_credentials,
        GithubAppTokens::new(InstallationTokenService::new(
            InstallationTokenConfig {
                client_id: config.github_sync_app_client_id.clone(),
                private_key_pem: config.github_sync_app_pem_secret_key.as_ref().to_owned(),
            },
            PgGithubSyncRepo::new(pool.clone()),
            GithubSyncClientImpl::default(),
        )),
        ReqwestForwarder::new()?,
    ));

    tracing::info!(environment = %config.environment, "agent egress service starting");

    api::setup_and_serve(egress, config.port, shutdown_signal()).await
}
