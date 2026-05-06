use anyhow::Context;
use axum::Router;
use context::ApiContext;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use secretsmanager_client::LocalOrRemoteSecret;
use tower::ServiceBuilder;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

// Routes
mod health;
mod internal;

// Misc
pub(crate) mod context;
mod swagger;

pub async fn setup_and_serve(state: ApiContext) -> anyhow::Result<()> {
    let cors = macro_cors::cors_layer();

    let port = state.config.port;
    let env = state.config.environment;
    let backfill_jobs = state.backfill_jobs.clone();
    let app = api_router(state.internal_auth_key.clone())
        .with_state(state)
        .layer(cors.clone())
        .layer(ServiceBuilder::new().layer(TraceLayer::new_for_http()))
        // The health router is attached here so we don't attach the logging middleware to it
        .merge(health::router().layer(cors))
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
        .with_graceful_shutdown(shutdown_signal(backfill_jobs))
        .await
        .context("error starting service")
}

/// Block on a SIGINT/SIGTERM signal, then fire every tracked backfill's
/// cancellation token so drains stop between pages instead of being killed
/// mid-publish when the runtime exits.
async fn shutdown_signal(backfill_jobs: crate::domain::jobs::BackfillJobs) {
    let ctrl_c = async {
        if let Err(e) = tokio::signal::ctrl_c().await {
            tracing::error!(error=?e, "failed to install ctrl_c handler");
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut sig) => {
                sig.recv().await;
            }
            Err(e) => {
                tracing::error!(error=?e, "failed to install SIGTERM handler");
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

    tracing::info!("shutdown signal received; cancelling in-flight backfills");
    backfill_jobs.cancel_all();
}

fn api_router(internal_secret: LocalOrRemoteSecret<InternalApiSecretKey>) -> Router<ApiContext> {
    Router::new().nest(
        "/internal",
        internal::router().layer(
            ServiceBuilder::new()
                .layer(axum::middleware::from_fn_with_state(
                    internal_secret,
                    macro_middleware::auth::internal_access::handler,
                ))
                .layer(axum::middleware::from_fn(
                    macro_middleware::connection_drop_prevention_handler,
                )),
        ),
    )
}
