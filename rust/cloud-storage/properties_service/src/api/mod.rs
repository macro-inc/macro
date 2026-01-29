use crate::api::context::{ApiContext, PropertiesHandlerState};
use anyhow::Context;
use axum::Router;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

pub mod context;
pub mod health;
pub mod internal;
pub mod permissions;
pub mod properties;
pub mod swagger;

pub async fn setup_and_serve(state: ApiContext) -> anyhow::Result<()> {
    let cors = macro_cors::cors_layer();

    let port = state.config.port;
    let env = state.config.environment;
    let app = api_router(state)
        .layer(TraceLayer::new_for_http())
        .merge(health::router())
        .layer(cors)
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()));

    let bind_address = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&bind_address)
        .await
        .with_context(|| format!("failed to bind to address {}", bind_address))?;

    tracing::info!(
        "properties service is up and running with environment {:?} on port {}",
        &env,
        &port
    );

    axum::serve(listener, app.into_make_service())
        .await
        .context("error running axum server")
}

fn api_router(app_state: ApiContext) -> Router {
    let handler_state = PropertiesHandlerState::from(&app_state);

    Router::new()
        .nest(
            "/properties",
            properties::router()
                .with_state(handler_state.clone())
                .layer(
                    tower::ServiceBuilder::new()
                        .layer(axum::middleware::from_fn(
                            macro_middleware::auth::initialize_user_context::handler,
                        ))
                        .layer(axum::middleware::from_fn_with_state(
                            app_state.jwt_args.clone(),
                            macro_middleware::auth::attach_user::handler,
                        )),
                ),
        )
        .nest(
            "/internal",
            internal::router()
                .with_state(handler_state)
                .layer(axum::middleware::from_fn_with_state(
                    app_state.clone(),
                    macro_middleware::auth::internal_access::handler,
                )),
        )
}
