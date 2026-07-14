use crate::api::context::ApiContext;
use anyhow::Context;
use axum::Router;
use tower::ServiceBuilder;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

pub mod context;
mod health;
pub(crate) mod proxy;
pub(crate) mod swagger;

pub async fn setup_and_serve(state: ApiContext, port: usize) -> anyhow::Result<()> {
    let cors = macro_cors::cors_layer();

    let env = state.environment;
    let app = api_router(state.clone())
        .with_state(state)
        .layer(ServiceBuilder::new().layer(TraceLayer::new_for_http()))
        .merge(health::router())
        .layer(cors)
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()));

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .unwrap();

    tracing::info!(
        "\n🖼️ image_proxy_service 🖼️\nenvironment {:?}\nport: {}",
        &env,
        &port
    );

    axum::serve(listener, app.into_make_service())
        .await
        .context("error starting service")
}

fn api_router(state: ApiContext) -> Router<ApiContext> {
    Router::new().nest(
        "/proxy",
        proxy::router().layer(
            ServiceBuilder::new().layer(axum::middleware::from_fn_with_state(
                state.jwt_args.clone(),
                macro_middleware::auth::decode_jwt::handler,
            )),
        ),
    )
}
