use crate::api::context::ApiContext;
use anyhow::Context;
use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::post;
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
mod health;
mod id_mapping;
mod preview;
pub mod stream;
pub(crate) mod swagger;
pub mod utils;

mod attachments;
mod chats;
pub mod structured_completion;

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
    let memory_service = api_context.memory_service.clone();
    let usage_service = api_context.usage_service.clone();
    let ai_projections_service = api_context.ai_projections_service.clone();
    let import_service = api_context.import_service.clone();
    let onboarding_service = api_context.onboarding_service.clone();
    let authorization_state = api_context.authorization_state.clone();

    let mcp_state = api_context.mcp_state.clone();

    let internal_router = Router::new()
        .nest("/chats", chats::router(api_context.clone()))
        .nest("/stream", stream::router())
        .route(
            "/structured-completion",
            post(structured_completion::structured_completion),
        )
        .route("/chat/completions", post(completions::handler))
        .nest("/attachments", attachments::router())
        .nest("/citations", citations::router())
        .nest("/preview", preview::router())
        .nest("/id_mapping", id_mapping::router())
        .merge(memory::inbound::axum_router::memory_router(
            memory::inbound::axum_router::MemoryRouterState {
                service: memory_service,
                authorization_state: authorization_state.clone(),
            },
        ))
        .merge(import::inbound::axum_router::import_router(
            import::inbound::axum_router::ImportRouterState {
                service: import_service,
                authorization_state: authorization_state.clone(),
            },
        ))
        .merge(onboarding::inbound::axum_router::onboarding_router(
            onboarding::inbound::axum_router::OnboardingRouterState {
                service: onboarding_service,
                authorization_state: authorization_state.clone(),
            },
        ))
        .merge(ai_usage::inbound::ai_usage_router(
            ai_usage::inbound::AiUsageRouterState {
                service: usage_service,
                authorization_state: authorization_state.clone(),
            },
        ))
        .merge(ai_projections::inbound::axum_router::ai_projections_router(
            ai_projections::inbound::axum_router::AiProjectionRouterState {
                service: ai_projections_service,
                authorization_state,
            },
        ))
        .merge(mcp_client::inbound::mcp_router(mcp_state.clone()))
        .with_state(api_context.clone());

    Router::new()
        .nest("/{version}", internal_router.clone())
        .merge(internal_router)
        .merge(mcp_client::inbound::mcp_oauth_callback_router(mcp_state))
}
