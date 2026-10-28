//! Public workspace MCP and OAuth, hosted on the harness's public listener.
mod analytics;
mod markdown_images;
#[cfg(test)]
mod test;
mod tool_mode_cache;
mod tool_response;
mod tool_service;

use crate::config::Config;
use analytics::McpAnalytics;
use analytics_client::{AnalyticsClient, AnalyticsClientConfig, PostHogConfig};
use anyhow::Context;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use mcp_auth_proxy::{
    domain::{
        redirect_uri::RedirectUriPolicy,
        service::{McpAuthProxyService, McpAuthProxyServiceDeps, McpAuthProxyServiceImpl},
    },
    outbound::{
        fusionauth::FusionAuthOAuthProvider,
        redis::{RedisClientRegistry, RedisInflightAuth},
    },
};
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
};
use secretsmanager_client::LocalOrRemoteSecret;
use std::sync::Arc;
use tool_mode_cache::CachedToolMode;
use tool_service::{AuthenticatedToolService, CodeModeSurface};

/// User-scoped code execution and the flag that offers it.
pub struct PublicCodeMode {
    pub service: Arc<dyn agent_code_mode::domain::UserCodeMode>,
    pub selector: Arc<dyn agent_inmem::domain::tool_mode::ToolModeSelector>,
}

const DEFAULT_MCP_ALLOWED_REDIRECT_HOSTS: [&str; 5] = [
    "claude.ai",
    "chatgpt.com",
    "chat.openai.com",
    "cursor.com",
    "www.cursor.com",
];

/// Build public MCP routes using the harness's shared tools and identities.
#[expect(
    clippy::too_many_arguments,
    reason = "each argument is a separate harness resource the router shares; bundling them only moves the list"
)]
pub async fn router(
    config: &Config,
    secrets: &secretsmanager_client::SecretsManager,
    tool_context: ai_tools::ToolServiceContext,
    db: sqlx::PgPool,
    jwt_args: JwtValidationArgs,
    background_tasks: tokio_util::task::TaskTracker,
    cancellation: tokio_util::sync::CancellationToken,
    code_mode: Option<PublicCodeMode>,
) -> anyhow::Result<axum::Router> {
    let public_url = macro_service_urls::McpPublicUrl::new()?;
    let auth_proxy = build_auth_proxy(config, secrets, &public_url).await?;
    let analytics = build_analytics(config, db);
    let item_base_url = macro_service_urls::AppServiceUrl::new()?.to_string();
    let static_file_base_url =
        url::Url::parse(macro_service_urls::StaticFileServiceUrl::new()?.as_ref())?;
    let mcp_public_host = public_url
        .parse_url()?
        .host_str()
        .context("public MCP URL has no host")?
        .to_owned();
    // Built once: the factory runs per request in stateless mode.
    let tools = ai_tools::tools_for(ai_tools::AiHost::Mcp).toolset;
    let code_mode = code_mode.map(|code_mode| {
        Arc::new(CodeModeSurface {
            native: ai_tools::tools_for_mcp_code_mode().toolset,
            tools: Arc::new(agent_code_mode::inbound::toolset::user_toolset()),
            context: agent_code_mode::inbound::toolset::UserCodeModeToolContext {
                service: code_mode.service,
                cognition: tool_context.cognition_tool_context.service.clone(),
            },
            selector: Arc::new(CachedToolMode::new(code_mode.selector)),
        })
    });
    // Create the MCP service with authenticated tool handler
    let mcp_service = StreamableHttpService::new(
        move || {
            let service = AuthenticatedToolService::new(
                tools.clone(),
                tool_context.clone(),
                item_base_url.clone(),
                static_file_base_url.clone(),
                analytics.clone(),
            );
            Ok(match &code_mode {
                Some(code_mode) => service.with_code_mode(code_mode.clone()),
                None => service,
            })
        },
        Arc::new(LocalSessionManager::default()),
        {
            let mut config = StreamableHttpServerConfig::default().with_allowed_hosts([
                mcp_public_host.clone(),
                "localhost".into(),
                "127.0.0.1".into(),
                "gateway.macro.com".into(),
                "dev-gateway.macro.com".into(),
            ]);
            config.stateful_mode = false;
            config.json_response = true;
            config
        },
    );

    let cleanup_state = auth_proxy.clone();
    background_tasks.spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            tokio::select! {
                _ = cancellation.cancelled() => break,
                _ = interval.tick() => {
                    if let Err(error) = cleanup_state.cleanup_expired().await {
                        tracing::error!(error = ?error, "MCP OAuth cleanup failed");
                    }
                }
            }
        }
    });
    // OAuth router has its own CORS and bearer middleware; mount outside the
    // browser API layers, with the same tracing layer as the harness API.
    Ok(
        mcp_auth_proxy::inbound::axum_router::mounted_mcp_router(auth_proxy, jwt_args, mcp_service)
            .layer(
                macro_tower_layers::MacroRequestIdAndTracingLayer::new(
                    std::time::Duration::from_millis(200),
                )
                .into_inner(),
            ),
    )
}

async fn build_auth_proxy(
    config: &Config,
    secretsmanager_client: &secretsmanager_client::SecretsManager,
    public_url: &macro_service_urls::McpPublicUrl,
) -> anyhow::Result<McpAuthProxyServiceImpl<RedisInflightAuth>> {
    let mcp_public_url = public_url.to_string();
    let mcp_oauth_redirect_uri = format!("{mcp_public_url}/oauth/callback");

    let fusionauth_api_key = LocalOrRemoteSecret::new_from_secret_manager(
        config.fusionauth_api_key_secret_key.as_ref().to_owned(),
        secretsmanager_client,
    )
    .await
    .context("failed to load FusionAuth API key")?;

    let fusionauth_client_secret = LocalOrRemoteSecret::new_from_secret_manager(
        config.fusionauth_client_secret_key.as_ref().to_owned(),
        secretsmanager_client,
    )
    .await
    .context("failed to load FusionAuth client secret")?;

    let google_client_secret = LocalOrRemoteSecret::new_from_secret_manager(
        config.google_client_secret_key.as_ref().to_owned(),
        secretsmanager_client,
    )
    .await
    .context("failed to load Google client secret")?;

    let fusionauth_public_url = config
        .fusionauth_public_url
        .value()
        .unwrap_or(config.fusionauth_base_url.as_ref())
        .to_owned();
    let fusionauth_client = fusionauth::FusionAuthClient::new(
        fusionauth_api_key.as_ref().to_owned(),
        config.fusionauth_client_id.as_ref().to_owned(),
        fusionauth_client_secret.as_ref().to_owned(),
        config.fusionauth_base_url.as_ref().to_owned(),
        mcp_oauth_redirect_uri,
        config.google_client_id.as_ref().to_owned(),
        google_client_secret.as_ref().to_owned(),
    )
    .with_public_url(fusionauth_public_url);

    let auth_provider = FusionAuthOAuthProvider::new(fusionauth_client)
        .await
        .context("failed to initialize MCP auth provider")?;
    let redis_client = redis::Client::open(config.redis_uri.as_ref().to_owned())
        .context("failed to initialize redis client for MCP auth proxy")?;
    let client_registry = Arc::new(RedisClientRegistry::new(redis_client.clone()));

    let redirect_uri_policy = build_redirect_uri_policy(config);
    tracing::info!(
        allowed_https_redirect_hosts = ?redirect_uri_policy.allowed_https_hosts().collect::<Vec<_>>(),
        "initialized MCP OAuth redirect URI policy"
    );

    Ok(McpAuthProxyServiceImpl::new(McpAuthProxyServiceDeps {
        public_url: mcp_public_url,
        redirect_uri_policy,
        inflight_auth: Arc::new(RedisInflightAuth::new(redis_client)),
        client_registrations: client_registry.clone(),
        refresh_token_bindings: client_registry,
        oauth_provider: Arc::new(auth_provider),
    }))
}

/// PostHog MCP analytics when `POSTHOG_API_KEY` is set; otherwise disabled.
fn build_analytics(config: &Config, db: sqlx::PgPool) -> McpAnalytics {
    let Some(api_key) = config.posthog_api_key.value() else {
        tracing::info!("POSTHOG_API_KEY unset; MCP analytics disabled");
        return McpAnalytics::disabled();
    };
    let client = AnalyticsClient::new(AnalyticsClientConfig {
        posthog: Some(PostHogConfig {
            api_key: api_key.to_owned(),
            host: config
                .posthog_host
                .value()
                .unwrap_or("https://us.i.posthog.com")
                .to_owned(),
        }),
        ..AnalyticsClientConfig::default()
    });
    McpAnalytics::posthog(
        client,
        entity_access::outbound::PgAccessRepository::new(db),
        config.environment,
    )
}

/// Builds the redirect URI policy the broker enforces at registration and at
/// authorize, from the configured host list or the built-in default.
fn build_redirect_uri_policy(config: &Config) -> RedirectUriPolicy {
    match config.mcp_allowed_redirect_hosts.value() {
        Some(hosts) => RedirectUriPolicy::new(hosts.split(',')),
        None => RedirectUriPolicy::new(DEFAULT_MCP_ALLOWED_REDIRECT_HOSTS),
    }
}
