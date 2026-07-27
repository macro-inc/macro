use anyhow::Context;
use axum::Router;
use context::ApiContext;
use tower::ServiceBuilder;
use tower_http::{compression::CompressionLayer, trace::TraceLayer};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

// Routes
mod health;

mod email;

// Misc
pub(crate) mod context;
pub(crate) mod gmail;
mod internal;
mod middleware;
pub(crate) mod swagger;

pub async fn setup_and_serve(state: ApiContext) -> anyhow::Result<()> {
    let env = state.config.environment;
    let port = state.config.port;
    let app = api_router(state.clone())
        .with_state(state)
        .merge(health::router())
        .layer(
            ServiceBuilder::new()
                .layer(TraceLayer::new_for_http())
                .layer(macro_cors::cors_layer())
                .layer(CompressionLayer::new().gzip(true)),
        )
        // The health router is attached here so we don't attach the logging middleware to it
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()));

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .unwrap();
    tracing::info!(
        "service is up and running with environment {:?} on port {}",
        env,
        port
    );
    axum::serve(listener, app.into_make_service())
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("error starting service")
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::error!(error=?error, "failed to install ctrl_c handler");
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
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("shutdown signal received");
}

fn api_router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .nest("/email", email::router(state))
        .nest("/gmail", gmail::router())
        .nest("/internal", internal::router())
}
