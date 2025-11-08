use crate::api::context::ApiContext;
use anyhow::Context;
use axum::Router;
use axum::extract::DefaultBodyLimit;
use context::GLOBAL_CONTEXT;
use model::version::{ServiceNameState, VersionedApiServiceName, validate_api_version};
use tower::ServiceBuilder;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

// Utilities
mod citations;
mod completions;
pub mod context;
mod document_text;
mod health;
mod internal;
mod models;
mod preview;
mod swagger;
pub mod utils;
mod ws;

mod attachments;
mod chats;
mod macros;
mod notification;
mod tools;

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
    axum::serve(listener, app.into_make_service())
        .await
        .context("error starting service")
}

fn api_router(api_context: ApiContext) -> Router {
    let internal_router = Router::new()
        .nest("/chats", chats::router(api_context.clone()))
        .nest("/", ws::router(api_context.clone()))
        .nest(
            "/internal",
            internal::router(api_context.clone()).nest("/notifications", notification::router()),
        )
        .nest("/macros", macros::router())
        .nest("/document_text", document_text::router())
        .nest("/attachments", attachments::router())
        .nest("/citations", citations::router())
        .nest("/preview", preview::router())
        .with_state(api_context.clone())
        .nest("/tools", tools::router())
        .nest("/completions", completions::router())
        .nest("/models", models::router())
        .layer(
            ServiceBuilder::new()
                .layer(axum::middleware::from_fn(
                    macro_middleware::auth::initialize_user_context::handler,
                ))
                .layer(axum::middleware::from_fn_with_state(
                    api_context.jwt_args,
                    macro_middleware::auth::attach_user::handler,
                )),
        );

    Router::new()
        .nest("/:version", internal_router.clone())
        .merge(internal_router)
}
