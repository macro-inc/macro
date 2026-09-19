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

#[cfg(test)]
mod test;

/// Path prefix the shared gateway ALB forwards unmodified.
const GATEWAY_PATH_PREFIX: &str = "/image-proxy";

fn mount_at_root_and_prefix(inner: Router) -> Router {
    Router::new()
        .merge(inner.clone())
        .nest(GATEWAY_PATH_PREFIX, inner)
}

pub async fn setup_and_serve(state: ApiContext, port: usize) -> anyhow::Result<()> {
    let env = state.environment;
    let app = app(state);

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

fn app(state: ApiContext) -> Router {
    let cors = macro_cors::cors_layer();

    let inner = api_router()
        .with_state(state)
        .layer(ServiceBuilder::new().layer(TraceLayer::new_for_http()))
        .merge(health::router())
        .layer(cors);

    mount_at_root_and_prefix(inner)
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()))
        .merge(SwaggerUi::new("/image-proxy/docs").url(
            "/image-proxy/api-doc/openapi.json",
            swagger::ApiDoc::openapi(),
        ))
}

fn api_router() -> Router<ApiContext> {
    Router::new().nest("/proxy", proxy::router())
}
