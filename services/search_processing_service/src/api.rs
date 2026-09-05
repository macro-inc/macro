use anyhow::Context;
use axum::Router;
use context::ApiContext;
use tokio_util::sync::CancellationToken;
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

#[cfg(test)]
mod test;

const GATEWAY_PATH_PREFIX: &str = "/search-processing";

pub async fn setup_and_serve(
    state: ApiContext,
    shutdown_token: CancellationToken,
) -> anyhow::Result<()> {
    let server_result = serve(state, shutdown_token.clone()).await;
    shutdown_token.cancel();
    server_result
}

async fn serve(state: ApiContext, shutdown_token: CancellationToken) -> anyhow::Result<()> {
    let cors = macro_cors::cors_layer();

    let port = state.config.port;
    let env = state.config.environment;
    let backfill_jobs = state.backfill_jobs.clone();
    let traced_api = api_router()
        .with_state(state)
        .layer(cors.clone())
        .layer(ServiceBuilder::new().layer(TraceLayer::new_for_http()));
    let health = health::router().layer(cors);
    let app = mount_at_root_and_prefix(traced_api.merge(health))
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()))
        .merge(SwaggerUi::new(format!("{GATEWAY_PATH_PREFIX}/docs")).url(
            format!("{GATEWAY_PATH_PREFIX}/api-doc/openapi.json"),
            swagger::ApiDoc::openapi(),
        ));

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .context("failed to bind API listener")?;
    tracing::info!(
        "service is up and running with environment {:?} on port {}",
        env,
        port
    );
    axum::serve(listener, app.into_make_service())
        .with_graceful_shutdown(shutdown_signal(backfill_jobs, shutdown_token))
        .await
        .context("error starting service")
}

/// Block on a SIGINT/SIGTERM signal, then fire every locally tracked
/// backfill's cancellation token so drains stop between pages instead of
/// being killed mid-publish when the runtime exits. Only jobs running on
/// this pod are cancelled — the registry is shared via DynamoDB but
/// cancellation tokens are per-instance.
async fn shutdown_signal(
    backfill_jobs: crate::domain::jobs::BackfillJobs,
    shutdown_token: CancellationToken,
) {
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

    tracing::info!("shutdown signal received; cancelling in-flight backfills on this pod");
    backfill_jobs.cancel_all_local();
    shutdown_token.cancel();
}

fn mount_at_root_and_prefix(inner: Router) -> Router {
    Router::new()
        .merge(inner.clone())
        .nest(GATEWAY_PATH_PREFIX, inner)
}

fn api_router() -> Router<ApiContext> {
    Router::new().nest(
        "/internal",
        internal::router().layer(ServiceBuilder::new().layer(axum::middleware::from_fn(
            macro_middleware::connection_drop_prevention_handler,
        ))),
    )
}
