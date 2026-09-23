//! Single-replica SSH/HTTP preview gateway, isolated from Macro's browser cookie domain.
mod adapters;
mod config;
use agent_preview::{
    domain::{PreviewService, Settings},
    inbound::{
        control::{self, ControlState},
        http, ssh, toolset,
    },
    outbound::ssh_tunnel::SshTunnel,
};
use axum::{Router, routing::get};
use axum::{
    body::Body,
    extract::{Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
};
use config::Config;
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, PgBotAuthorizationRepo, PgBotAuthorizer,
    PgUserApiKeyAuthorizationRepo, PgUserApiKeyAuthorizer,
};
use macro_service_urls::ConnectionGatewayUrl;
use std::{sync::Arc, time::Duration};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    let entrypoint = macro_entrypoint::MacroEntrypoint::default()
        .suppress_dependency_logs(&["russh", "russh_util", "rmcp"])
        .init();
    let result = run().await;
    entrypoint.shutdown();
    result
}
async fn run() -> Result<(), rootcause::Report> {
    let config = macro_config::ConfigLoader::load::<Config>()?;
    let aws = macro_aws_config::get_macro_aws_config().await;
    let secrets =
        secretsmanager_client::SecretsManager::new(aws_sdk_secretsmanager::Client::new(&aws));
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(10)
        .connect(config.database_url.as_ref())
        .await?;
    let access = Arc::new(
        entity_access::domain::service::EntityAccessServiceImpl::new(
            entity_access::outbound::PgAccessRepository::new(pool.clone()),
        ),
    );
    let auth = MacroAuthorizationServiceImpl::new(
        MacroAuthJwtValidator::new(
            macro_auth::middleware::decode_jwt::JwtValidationArgs::new_with_secret_manager(
                config.environment,
                &secrets,
            )
            .await?,
        ),
        InternalAuthConfig {
            api_key: config.internal_api_key.clone(),
            default_user_id: None,
        },
        PgBotAuthorizer::new(PgBotAuthorizationRepo::new(pool.clone())),
        PgUserApiKeyAuthorizer::new(PgUserApiKeyAuthorizationRepo::new(pool.clone())),
    );
    let key = ssh::host_key(&config.preview_ssh_host_key)?;
    let public_key = ssh::public_key(&key)?;
    let service = PreviewService::new(
        Settings {
            local_ssh_fallback: matches!(config.environment, macro_env::Environment::Local),
            domain: config.preview_domain,
            https_port: config.preview_https_port,
            ssh_host: config.preview_ssh_host,
            ssh_port: config.preview_ssh_public_port,
            ssh_proxy_host: config
                .preview_ssh_proxy_host
                .filter(|host| !host.is_empty()),
            host_key: public_key,
            app_origin: config.preview_app_origin,
        },
        Arc::new(adapters::MacroAuthority {
            sessions: agent_session::outbound::postgres::PgAgentSessionRepo::new(pool),
            access: access.clone(),
        }),
        Arc::new(adapters::Realtime(
            connection_gateway_client::ConnectionGatewayClient::new(
                config.internal_api_key,
                ConnectionGatewayUrl::new()?.to_string(),
            ),
        )),
    )?;
    let control = control::router(ControlState::new(
        service.clone(),
        access,
        MacroAuthorizationState::new(Arc::new(auth)),
    ));
    let mcp = toolset::router(
        service.clone(),
        config
            .preview_control_hosts
            .split(',')
            .map(|s| s.trim().to_owned())
            .collect(),
    );
    let app = control
        .merge(mcp)
        .route("/health", get(|| async { "ok" }))
        .layer(macro_cors::cors_layer());
    let app = Router::new()
        .merge(app.clone())
        .nest("/preview", app)
        .layer(middleware::from_fn_with_state(
            Arc::new(tokio::sync::Semaphore::new(128)),
            admit_control,
        ));
    let control_listener = TcpListener::bind(("0.0.0.0", config.port)).await?;
    let public_listener = TcpListener::bind(("0.0.0.0", config.preview_http_port)).await?;
    let ssh_listener = TcpListener::bind(("0.0.0.0", config.preview_ssh_port)).await?;
    let shutdown = tokio_util::sync::CancellationToken::new();
    let signal = shutdown.clone();
    tokio::spawn(async move {
        macro_entrypoint::shutdown_signal().await;
        signal.cancel();
    });
    let sweeper = service.clone();
    let sweep_shutdown = shutdown.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! { _ = sweep_shutdown.cancelled() => break, _ = tokio::time::sleep(Duration::from_secs(15)) => sweeper.sweep().await }
        }
    });
    tokio::try_join!(
        async {
            axum::serve(control_listener, app)
                .with_graceful_shutdown(shutdown.clone().cancelled_owned())
                .await
                .map_err(rootcause::Report::from)
        },
        async {
            axum::serve(public_listener, http::router(service.clone()))
                .with_graceful_shutdown(shutdown.clone().cancelled_owned())
                .await
                .map_err(rootcause::Report::from)
        },
        async {
            ssh::serve(
                ssh_listener,
                key,
                service.clone(),
                Arc::new(|handle| Arc::new(SshTunnel::new(handle))),
                shutdown.clone(),
            )
            .await
        },
    )?;
    Ok(())
}

// MCP is stateless JSON and control responses are small. Bound unauthenticated
// work before it can occupy the database pool or buffer arbitrary request bodies.
async fn admit_control(
    State(slots): State<Arc<tokio::sync::Semaphore>>,
    request: Request,
    next: Next,
) -> Response {
    let Ok(_permit) = slots.try_acquire_owned() else {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    };
    let work = async {
        let (parts, body) = request.into_parts();
        let Ok(body) = axum::body::to_bytes(body, 64 * 1024).await else {
            return StatusCode::PAYLOAD_TOO_LARGE.into_response();
        };
        next.run(Request::from_parts(parts, Body::from(body))).await
    };
    tokio::time::timeout(Duration::from_secs(15), work)
        .await
        .unwrap_or_else(|_| StatusCode::REQUEST_TIMEOUT.into_response())
}
