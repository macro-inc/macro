//! Composition root for the agent proxy service.
//!
//! Runs the user-facing HTTP API (agent CRUD, provisioning runtime
//! connections, and posting ACP messages to sessions) alongside a single
//! shared runtime WebSocket endpoint
//! ([`agent_proxy::outbound::shared_runtime_connections::SharedRuntimeConnections`])
//! that every external agent's runtime dials into, disambiguated by an
//! `?id=` query parameter; accepted connections are drained and driven into
//! the domain service by [`agent_proxy::inbound::runtime::RuntimeConnectionDriver`].

#![recursion_limit = "256"]

mod config;

use std::sync::Arc;

use agent_proxy::domain::service::AgentProxyServiceImpl;
use agent_proxy::inbound::http::{AgentProxyRouterState, agent_proxy_router, health};
use agent_proxy::inbound::runtime::RuntimeConnectionDriver;
use agent_proxy::outbound::gateway::GatewayNotifier;
use agent_proxy::outbound::runtime_registry::SessionRegistry;
use agent_proxy::outbound::shared_runtime_connections::SharedRuntimeConnections;
use agent_proxy::swagger::ApiDoc;
use anyhow::{Context, Result};
use axum::Router;
use chat::outbound::postgres::PgChatRepo;
use config::Config;
use connection_gateway_client::client::ConnectionGatewayClient;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, NoBotAuthorizer,
};
use macro_entrypoint::MacroEntrypoint;
use macro_service_urls::ConnectionGatewayUrl;
use sqlx::postgres::PgPoolOptions;
use stream::outbound::redis_pg::RedisPostgresStreamRepo;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

#[tokio::main]
#[tracing::instrument(err)]
async fn main() -> Result<()> {
    MacroEntrypoint::default().init();

    let config = Config::from_env()?;
    let environment = config.environment;

    let db = PgPoolOptions::new()
        .min_connections(3)
        .max_connections(10)
        .connect(&config.database_url)
        .await
        .context("failed to connect to macrodb")?;

    let gateway_client = ConnectionGatewayClient::new(
        config.internal_api_key.to_string(),
        ConnectionGatewayUrl::new()?.to_string(),
    );

    // Live chat updates ride the same Redis-durable-stream pipeline
    // `document_cognition_service` uses, so the frontend's existing chat
    // renderer (already wired for message_type "stream") picks them up with
    // no frontend changes.
    let redis_client =
        redis::Client::open(config.redis_host.as_str()).context("failed to build redis client")?;
    let stream_repo = RedisPostgresStreamRepo::new(redis_client, db.clone()).obj();

    // All runtimes dial the same shared WebSocket endpoint, disambiguated by
    // an `?id=` query parameter; accepted connections are handed to the
    // driver below over `incoming`.
    let (incoming_tx, incoming_rx) = tokio::sync::mpsc::unbounded_channel();
    let runtime_connections = Arc::new(SharedRuntimeConnections::new(
        config.runtime_advertise_host,
        config.runtime_port,
        incoming_tx,
    ));

    let registry = Arc::new(SessionRegistry::new());
    let service = Arc::new(AgentProxyServiceImpl::new(
        PgChatRepo::new(db.clone()),
        Arc::clone(&registry),
        GatewayNotifier::new(gateway_client),
        Arc::clone(&runtime_connections),
        stream_repo,
    ));

    let connection_driver = Arc::new(RuntimeConnectionDriver::new(
        Arc::clone(&registry),
        Arc::clone(&service),
    ));
    tokio::spawn(connection_driver.run(incoming_rx));

    let runtime_addr = format!("0.0.0.0:{}", config.runtime_port);
    let runtime_listener = tokio::net::TcpListener::bind(&runtime_addr)
        .await
        .context("failed to bind shared runtime listener")?;
    tracing::info!("shared runtime endpoint listening on {runtime_addr}");
    tokio::spawn(async move {
        let _ = axum::serve(runtime_listener, runtime_connections.into_router()).await;
    });

    // User-facing HTTP API.
    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&macro_aws_config::get_macro_aws_config().await),
    );
    let jwt_args = JwtValidationArgs::new_with_secret_manager(environment, &secretsmanager_client)
        .await
        .context("failed to build jwt validation args")?;
    let authorization_service = MacroAuthorizationServiceImpl::new(
        MacroAuthJwtValidator::new(jwt_args),
        InternalAuthConfig {
            api_key: config.internal_api_key.to_string(),
            default_user_id: None,
        },
        NoBotAuthorizer,
    );
    let authorization_state = MacroAuthorizationState::new(Arc::new(authorization_service));

    let state = AgentProxyRouterState {
        service,
        authorization_state,
    };
    let router = Router::new()
        .route("/health", axum::routing::get(health))
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", ApiDoc::openapi()))
        .merge(agent_proxy_router::<_, _, ()>(state))
        .layer(macro_cors::cors_layer());

    let addr = format!("0.0.0.0:{}", config.port);
    let http_listener = tokio::net::TcpListener::bind(&addr)
        .await
        .context("failed to bind http listener")?;
    tracing::info!("agent proxy service listening on {addr}");
    axum::serve(http_listener, router.into_make_service()).await?;

    unreachable!("axum::serve returned without error");
}
