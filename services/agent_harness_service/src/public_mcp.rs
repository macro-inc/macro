//! Public workspace MCP and OAuth, hosted on the harness's public listener.
//!
//! With `ENABLE_AGENT_SETUP` on it also serves agent-led setup: the Setup
//! tools, setup-first instructions for people who signed up through their
//! agent, the sign-in hook that hands such an account to the agent, and MCP
//! analytics. Off, it serves exactly what it did before.
mod agent_led;
mod client_attribution;
mod markdown_images;
mod request_observer;
mod setup_ports;
mod setup_prompt;
mod sign_in;
mod telemetry;
#[cfg(test)]
mod test;
#[cfg(test)]
mod test_support;
mod tool_response;
mod tool_service;

use crate::config::Config;
use agent_led::{AgentHandover, PgAccountDirectory};
use anyhow::Context;
use client_attribution::{ClientAttribution, RedisClientStore};
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
use request_observer::{NoObserver, RequestObserver, TelemetryObserver};
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
};
use secretsmanager_client::LocalOrRemoteSecret;
use setup_ports::HandoverSetupAccounts;
use setup_prompt::{ServiceSetupHint, SetupHintSource};
use sign_in::AgentSignIn;
use std::sync::Arc;
use telemetry::McpTelemetry;
use tool_service::AuthenticatedToolService;

const DEFAULT_MCP_ALLOWED_REDIRECT_HOSTS: [&str; 6] = [
    "claude.ai",
    "claude.com",
    "chatgpt.com",
    "chat.openai.com",
    "cursor.com",
    "www.cursor.com",
];

/// Preserve the public MCP domain verification endpoint from the former host.
async fn openai_domain_verification() -> String {
    crate::config::OpenaiDomainVerificationToken::new()
        .and_then(|token| token.value().map(str::to_string))
        .unwrap_or_else(|| "PLACEHOLDER_TOKEN_REPLACE_WITH_ACTUAL_OPENAI_TOKEN".to_string())
}

/// What agent-led setup adds to public MCP when it is switched on.
struct AgentSetupParts {
    sign_in_observer: Arc<dyn mcp_auth_proxy::domain::ports::SignInObserver>,
    observer: Arc<dyn RequestObserver>,
    setup_hint: Arc<dyn SetupHintSource>,
}

/// Builds agent-led setup over the shared tool context, wiring its tools.
fn build_agent_setup(
    config: &Config,
    tool_context: &mut ai_tools::ToolServiceContext,
    jwt_args: &JwtValidationArgs,
    pool: &sqlx::PgPool,
    mcp_servers: Arc<mcp_client::outbound::pg_server_repo::PgServerRepo>,
    redis_client: redis::Client,
) -> anyhow::Result<AgentSetupParts> {
    let parts = tool_context
        .agent_setup_parts
        .clone()
        .context("agent-led setup needs the import service, which this host did not build")?;
    let onboarding = Arc::new(onboarding::domain::service::OnboardingServiceImpl::new(
        onboarding::outbound::pg_onboarding_repo::PgOnboardingRepo::new(pool.clone()),
        mcp_servers,
    ));
    let handover = AgentHandover::new(onboarding.clone(), PgAccountDirectory::new(pool.clone()));
    let setup_service = Arc::new(agent_setup::domain::service::AgentSetupService::new(
        agent_setup::domain::service::SetupPorts {
            imports: parts.imports,
            connections: parts.connections,
            inbox: parts.inbox,
            accounts: Arc::new(HandoverSetupAccounts::new(onboarding, handover.clone())),
        },
        agent_setup::domain::service::SetupConfig::new(config.app_base_url.as_ref()),
    ));
    tool_context.agent_setup_tool_context =
        ai_tools::ToolAgentSetupToolContext::wired(setup_service.clone());

    let attribution = ClientAttribution::new(RedisClientStore::new(redis_client));
    let telemetry = McpTelemetry::new(config.posthog_api_key.value(), config.posthog_host.value());
    // Analytics need PostHog configured; without it nothing is recorded, not
    // even which client a token belongs to.
    let observer: Arc<dyn RequestObserver> = if telemetry.is_enabled() {
        Arc::new(TelemetryObserver::new(
            telemetry.clone(),
            attribution.clone(),
        ))
    } else {
        Arc::new(NoObserver)
    };
    let sign_in_observer = Arc::new(AgentSignIn::new(
        Arc::new(jwt_args.clone()),
        Arc::new(email::outbound::EmailServiceHttpClient::new(
            macro_service_urls::EmailServiceUrl::new()?.to_string(),
        )),
        handover,
        attribution,
        telemetry,
    ));
    Ok(AgentSetupParts {
        sign_in_observer,
        observer,
        setup_hint: Arc::new(ServiceSetupHint::new(setup_service)),
    })
}

/// Build public MCP routes using the harness's shared tools and identities.
#[expect(
    clippy::too_many_arguments,
    reason = "the composition root hands over each shared piece once"
)]
pub async fn router(
    config: &Config,
    secrets: &secretsmanager_client::SecretsManager,
    mut tool_context: ai_tools::ToolServiceContext,
    jwt_args: JwtValidationArgs,
    pool: sqlx::PgPool,
    mcp_servers: Arc<mcp_client::outbound::pg_server_repo::PgServerRepo>,
    background_tasks: tokio_util::task::TaskTracker,
    cancellation: tokio_util::sync::CancellationToken,
) -> anyhow::Result<axum::Router> {
    let redis_client = redis::Client::open(config.redis_uri.as_ref().to_owned())
        .context("failed to initialize redis client for MCP auth proxy")?;
    // Agent-led setup is off unless `ENABLE_AGENT_SETUP=true`; off, public MCP
    // serves exactly what it did before.
    let agent_setup = if config.enable_agent_setup.is_enabled() {
        Some(build_agent_setup(
            config,
            &mut tool_context,
            &jwt_args,
            &pool,
            mcp_servers,
            redis_client.clone(),
        )?)
    } else {
        None
    };
    let sign_in_observer: Arc<dyn mcp_auth_proxy::domain::ports::SignInObserver> =
        match &agent_setup {
            Some(setup) => setup.sign_in_observer.clone(),
            None => Arc::new(mcp_auth_proxy::domain::ports::NoSignInObserver),
        };
    let observer: Arc<dyn RequestObserver> = match &agent_setup {
        Some(setup) => setup.observer.clone(),
        None => Arc::new(NoObserver),
    };
    let setup_hint = agent_setup.map(|setup| setup.setup_hint);
    let auth_proxy = build_auth_proxy(config, secrets, redis_client, sign_in_observer).await?;
    let item_base_url = config.app_base_url.to_string();
    let static_file_base_url =
        url::Url::parse(macro_service_urls::StaticFileServiceUrl::new()?.as_ref())?;
    let mcp_public_host = url::Url::parse(config.mcp_public_url.as_ref())?
        .host_str()
        .context("MCP_PUBLIC_URL has no host")?
        .to_owned();
    // Create the MCP service with authenticated tool handler
    let mcp_service = StreamableHttpService::new(
        move || {
            let tools = if setup_hint.is_some() {
                ai_tools::mcp_tools_with_agent_setup()
            } else {
                ai_tools::tools_for(ai_tools::AiHost::Mcp)
            };
            let service = AuthenticatedToolService::new(
                tools.toolset,
                tool_context.clone(),
                item_base_url.clone(),
                static_file_base_url.clone(),
            )
            .with_observer(observer.clone());
            Ok(match &setup_hint {
                Some(setup_hint) => service.with_agent_setup(setup_hint.clone()),
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
            .route(
                "/.well-known/openai-apps-challenge",
                axum::routing::get(openai_domain_verification),
            )
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
    redis_client: redis::Client,
    sign_in_observer: Arc<dyn mcp_auth_proxy::domain::ports::SignInObserver>,
) -> anyhow::Result<McpAuthProxyServiceImpl<RedisInflightAuth>> {
    let mcp_public_url: String = config.mcp_public_url.as_ref().to_owned();
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
        sign_in_observer,
    }))
}

/// Builds the redirect URI policy the broker enforces at registration and at
/// authorize, from the configured host list or the built-in default.
fn build_redirect_uri_policy(config: &Config) -> RedirectUriPolicy {
    match config.mcp_allowed_redirect_hosts.value() {
        Some(hosts) => RedirectUriPolicy::new(hosts.split(',')),
        None => RedirectUriPolicy::new(DEFAULT_MCP_ALLOWED_REDIRECT_HOSTS),
    }
}
