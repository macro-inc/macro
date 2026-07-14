use std::time::Duration;

use anyhow::Context;
use axum::Router;
use context::ApiContext;
use tokio::sync::oneshot;
use tower::ServiceBuilder;
use tower_http::{compression::CompressionLayer, trace::TraceLayer};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

const HTTP_DRAIN_TIMEOUT: Duration = Duration::from_secs(4);

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
        .context("failed to bind email service listener")?;
    tracing::info!(
        "service is up and running with environment {:?} on port {}",
        env,
        port
    );

    let (shutdown_started_sender, shutdown_started_receiver) = oneshot::channel();
    let server_result = {
        let server = axum::serve(listener, app.into_make_service())
            .with_graceful_shutdown(shutdown_signal(shutdown_started_sender));
        let server = std::future::IntoFuture::into_future(server);
        tokio::pin!(server);

        tokio::select! {
            result = &mut server => result,
            shutdown_started = shutdown_started_receiver => {
                shutdown_started
                    .inspect_err(|error| {
                        tracing::error!(
                            error = ?error,
                            "HTTP shutdown notification channel closed unexpectedly"
                        );
                    })
                    .ok();

                match tokio::time::timeout(HTTP_DRAIN_TIMEOUT, &mut server).await {
                    Ok(result) => result,
                    Err(_) => {
                        tracing::warn!(
                            drain_timeout_ms = HTTP_DRAIN_TIMEOUT.as_millis(),
                            "HTTP graceful shutdown timed out; terminating active requests"
                        );
                        Ok(())
                    }
                }
            }
        }
    };

    tracing::info!("email HTTP server stopped");
    server_result.context("email HTTP server failed")
}

async fn shutdown_signal(shutdown_started_sender: oneshot::Sender<()>) {
    let interrupt = async {
        match tokio::signal::ctrl_c().await {
            Ok(()) => {}
            Err(error) => {
                tracing::error!(error = ?error, "failed to listen for SIGINT");
                std::future::pending::<()>().await;
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
                tracing::error!(error = ?error, "failed to install SIGTERM handler");
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = interrupt => {}
        _ = terminate => {}
    }

    tracing::info!("shutdown signal received; starting HTTP graceful shutdown");
    let _ = shutdown_started_sender.send(());
}

fn api_router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .nest(
            "/email",
            email::router(state.clone()).layer(axum::middleware::from_fn_with_state(
                state.clone(),
                macro_middleware::auth::decode_jwt::handler,
            )),
        )
        .nest("/gmail", gmail::router())
        .nest(
            "/internal",
            internal::router().layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn_with_state(
                        state,
                        macro_middleware::auth::internal_access::handler,
                    ))
                    .layer(axum::middleware::from_fn(
                        macro_middleware::auth::initialize_user_context::handler,
                    )),
            ),
        )
}
