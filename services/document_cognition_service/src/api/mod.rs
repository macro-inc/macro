use crate::api::context::ApiContext;
use anyhow::Context;
use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::post;
use context::GLOBAL_CONTEXT;
use model::version::{ServiceNameState, VersionedApiServiceName, validate_api_version};
use std::future::{IntoFuture, pending};
use std::time::Duration;
use tokio_util::sync::CancellationToken;
use tower::ServiceBuilder;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

// Utilities
mod citations;
mod completions;
pub mod context;
mod health;
mod id_mapping;
mod preview;
pub mod stream;
pub(crate) mod swagger;
pub mod utils;

mod attachments;
mod chats;
pub mod structured_completion;

const ACTIVE_REQUEST_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(4);

#[tracing::instrument(err, skip(state))]
pub async fn setup_and_serve(state: ApiContext) -> anyhow::Result<()> {
    let cors = macro_cors::cors_layer();

    tracing::trace!("initializing global api context");
    let global_api_context = state.clone();

    if GLOBAL_CONTEXT.set(global_api_context).is_err() {
        panic!("GLOBAL_CONTEXT is set already")
    }

    let port = state.config.port;
    let environment = state.config.environment;
    let app = api_router(state.clone())
        .layer(cors.clone())
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(1024 * 1024 * 1024)) // 1GB
        .layer(
            ServiceBuilder::new()
                .layer(TraceLayer::new_for_http())
                .layer(axum::middleware::from_fn_with_state(
                    ServiceNameState {
                        service_name: VersionedApiServiceName::DocumentCognitionService,
                    },
                    validate_api_version,
                )),
        )
        .merge(health::router().layer(cors))
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()));

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .context("failed to bind TCP listener")?;
    tracing::info!(
        port,
        ?environment,
        "document cognition service is up and running"
    );
    let shutdown = CancellationToken::new();
    let server_shutdown = shutdown.clone();
    let server = axum::serve(listener, app.into_make_service())
        .with_graceful_shutdown(async move {
            server_shutdown.cancelled().await;
        })
        .into_future();
    tokio::pin!(server);

    tokio::select! {
        result = &mut server => result.context("error starting service"),
        () = shutdown_signal() => {
            tracing::info!(
                timeout_seconds = ACTIVE_REQUEST_SHUTDOWN_TIMEOUT.as_secs(),
                "stopping HTTP server and waiting for active requests"
            );
            shutdown.cancel();

            match tokio::time::timeout(ACTIVE_REQUEST_SHUTDOWN_TIMEOUT, &mut server).await {
                Ok(result) => result.context("error starting service"),
                Err(_) => {
                    tracing::warn!(
                        timeout_seconds = ACTIVE_REQUEST_SHUTDOWN_TIMEOUT.as_secs(),
                        "active request shutdown timed out; forcing HTTP server shutdown"
                    );
                    Ok(())
                }
            }
        }
    }
}

async fn shutdown_signal() {
    let interrupt = async {
        match tokio::signal::ctrl_c().await {
            Ok(()) => {}
            Err(error) => {
                tracing::error!(error=?error, "failed to install SIGINT handler");
                pending::<()>().await;
            }
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => {
                tracing::error!(error=?error, "failed to install SIGTERM handler");
                pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = pending::<()>();

    tokio::select! {
        () = interrupt => {}
        () = terminate => {}
    }

    tracing::info!("shutdown signal received");
}

fn api_router(api_context: ApiContext) -> Router {
    let memory_service = api_context.memory_service.clone();
    let usage_service = api_context.usage_service.clone();
    let ai_projections_service = api_context.ai_projections_service.clone();

    let mcp_state = api_context.mcp_state.clone();

    let internal_router = Router::new()
        .nest("/chats", chats::router(api_context.clone()))
        .nest("/stream", stream::router(api_context.clone()))
        .route(
            "/structured-completion",
            post(structured_completion::structured_completion).layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn(
                        macro_middleware::auth::ensure_user_exists::handler,
                    ))
                    .layer(axum::middleware::from_fn_with_state(
                        api_context.clone(),
                        macro_middleware::user_permissions::attach_user_permissions::handler,
                    )),
            ),
        )
        .nest("/attachments", attachments::router())
        .nest("/citations", citations::router())
        .nest("/preview", preview::router())
        .nest("/id_mapping", id_mapping::router())
        .merge(memory::inbound::axum_router::memory_router(memory_service))
        .merge(ai_usage::inbound::ai_usage_router(usage_service))
        .merge(ai_projections::inbound::axum_router::ai_projections_router(
            ai_projections::inbound::axum_router::AiProjectionRouterState {
                service: ai_projections_service,
            },
        ))
        .merge(mcp_client::inbound::mcp_router(mcp_state.clone()))
        .with_state(api_context.clone())
        .route(
            "/chat/completions",
            post(completions::handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn(macro_middleware::auth::ensure_user_exists::handler),
            )),
        )
        .layer(
            ServiceBuilder::new()
                .layer(axum::middleware::from_fn(
                    macro_middleware::auth::initialize_user_context::handler,
                ))
                .layer(axum::middleware::from_fn_with_state(
                    api_context.jwt_args.clone(),
                    macro_middleware::auth::attach_user::handler,
                )),
        );

    Router::new()
        .nest("/{version}", internal_router.clone())
        .merge(internal_router)
        .merge(mcp_client::inbound::mcp_oauth_callback_router(mcp_state))
}
