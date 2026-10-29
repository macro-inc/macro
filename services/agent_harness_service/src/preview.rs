//! Replicated SSH/HTTP preview gateway, isolated from Macro's browser cookie domain.
mod adapters;
pub mod config;
use agent_preview::{
    domain::{PreviewService, Settings},
    inbound::{
        control::{self, ControlState},
        http, ssh, toolset,
    },
    outbound::ssh_tunnel::SshTunnel,
};
use axum::Router;
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

pub async fn build(
    config: Config,
    database_url: &str,
    pool: sqlx::PgPool,
    shutdown: tokio_util::sync::CancellationToken,
    tasks: tokio_util::task::TaskTracker,
) -> Result<Router, rootcause::Report> {
    let app_url = macro_service_urls::AppServiceUrl::new()?;
    let control_url = macro_service_urls::PreviewGatewayUrl::new()?;
    let mut allowed_hosts = Vec::new();
    let mut control_urls = vec![control_url.parse_url()?];
    if matches!(config.environment, macro_env::Environment::Local) {
        control_urls.push(app_url.parse_url()?);
    }
    for url in control_urls {
        let host = url
            .host_str()
            .ok_or_else(|| rootcause::report!("preview control URL requires a host"))?;
        allowed_hosts.push(host.to_owned());
    }
    if matches!(config.environment, macro_env::Environment::Local) {
        allowed_hosts.extend(["localhost".to_owned(), "127.0.0.1".to_owned()]);
    }
    let aws = macro_aws_config::get_macro_aws_config().await;
    let secrets =
        secretsmanager_client::SecretsManager::new(aws_sdk_secretsmanager::Client::new(&aws));
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
    let peer_address =
        agent_preview::outbound::peer::address(database_url, config.preview_http_port).await?;
    let repository = Arc::new(agent_preview::outbound::postgres::PgPreviewRepository::new(
        pool.clone(),
    ));
    let replica = macro_uuid::Uuid::now_v7();
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
            app_origin: app_url.to_string(),
        },
        Arc::new(adapters::MacroAuthority {
            sessions: agent_session::outbound::postgres::PgAgentSessionRepo::new(
                pool.clone(),
                entity_registry_db_utils::OwnedEntityRegistrar::new(
                    entity_registry::OwnerGrantPolicy::new(
                        bots::outbound::pg_bots_repo::PgBotsRepo::new(pool.clone()),
                    ),
                ),
            ),
            access: access.clone(),
        }),
        Arc::new(adapters::Realtime(
            connection_gateway_client::ConnectionGatewayClient::new(
                config.internal_api_key,
                ConnectionGatewayUrl::new()?.to_string(),
            ),
        )),
        repository,
        replica,
        Arc::new(agent_preview::outbound::peer::TcpPeerConnector),
    )?;
    service.heartbeat(peer_address).await?;
    let control = control::router(ControlState::new(
        service.clone(),
        access,
        MacroAuthorizationState::new(Arc::new(auth)),
    ));
    tracing::info!(
        hosts = ?allowed_hosts,
        "preview control listener ready"
    );
    let mcp = toolset::router(service.clone(), allowed_hosts);
    let app = control.merge(mcp).layer(macro_cors::cors_layer());
    let app = Router::new()
        .nest("/preview", app)
        .layer(middleware::from_fn_with_state(
            Arc::new(tokio::sync::Semaphore::new(128)),
            admit_control,
        ));
    let public_listener = TcpListener::bind(("0.0.0.0", config.preview_http_port)).await?;
    let ssh_listener = TcpListener::bind(("0.0.0.0", config.preview_ssh_port)).await?;
    let sweeper = service.clone();
    let sweep_shutdown = shutdown.clone();
    tasks.spawn(async move {
        loop {
            tokio::select! { _ = sweep_shutdown.cancelled() => break, _ = tokio::time::sleep(Duration::from_secs(10)) => {
                if let Err(error) = sweeper.heartbeat(peer_address).await { tracing::warn!(?error, "preview heartbeat failed"); }
                sweeper.sweep().await;
            } }
        }
    });
    tasks.spawn(async move {
        let result = tokio::try_join!(
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
        );
        if let Err(error) = result {
            tracing::error!(error = ?error, "preview listeners failed");
            shutdown.cancel();
        }
    });
    Ok(app.layer(
        macro_tower_layers::MacroRequestIdAndTracingLayer::new(Duration::from_millis(200))
            .into_inner(),
    ))
}

// MCP is stateless JSON and control responses are small. Bound unauthenticated
// work before it can occupy the database pool or buffer arbitrary request bodies.
async fn admit_control(
    State(slots): State<Arc<tokio::sync::Semaphore>>,
    request: Request,
    next: Next,
) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    let Ok(_permit) = slots.try_acquire_owned() else {
        tracing::warn!(%method, %path, "preview control overloaded");
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    };
    let work = async {
        let (parts, body) = request.into_parts();
        let Ok(body) = axum::body::to_bytes(body, 64 * 1024).await else {
            tracing::warn!(%method, %path, "preview control request too large");
            return StatusCode::PAYLOAD_TOO_LARGE.into_response();
        };
        next.run(Request::from_parts(parts, Body::from(body))).await
    };
    tokio::time::timeout(Duration::from_secs(15), work)
        .await
        .unwrap_or_else(|_| {
            tracing::warn!(%method, %path, "preview control timed out");
            StatusCode::REQUEST_TIMEOUT.into_response()
        })
}
