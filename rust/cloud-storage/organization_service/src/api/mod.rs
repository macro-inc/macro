use anyhow::Context;
use axum::Router;
use axum::extract::Request;
use axum::http::Method;
use axum::middleware::Next;
use context::ApiContext;
use tower::ServiceBuilder;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

// Utilities
pub mod context;

// Routes
mod health;
mod internal;
mod organization;
mod users;

mod middleware;

mod swagger;

// Constants
// role based constants
pub static MACRO_ORGANIZATION_IT_ROLE: &str = "organization_it";

// permission based constants
pub static MACRO_IT_PANEL_PERMISSION: &str = "write:it_panel";

pub async fn setup_and_serve(state: ApiContext) -> anyhow::Result<()> {
    let cors = macro_cors::cors_layer();

    let app = api_router(state.clone())
        .layer(cors.clone())
        .layer(TraceLayer::new_for_http())
        // The health router is attached here so we don't attach the logging middleware to it
        .merge(health::router().layer(cors))
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()));

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", state.config.port))
        .await
        .unwrap();
    tracing::info!(
        "organization service is up and running with environment {:?} on port {}",
        &state.config.environment,
        &state.config.port
    );
    axum::serve(listener, app.into_make_service())
        .await
        .context("error starting service")
}

fn api_router(state: ApiContext) -> Router {
    Router::new()
        .nest(
            "/users",
            users::router().layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn_with_state(
                        state.clone(),
                        macro_middleware::auth::decode_jwt::handler,
                    ))
                    .layer(axum::middleware::from_fn_with_state(
                        state.clone(),
                        macro_middleware::user_permissions::attach_user_permissions::handler,
                    ))
                    .layer(axum::middleware::from_fn(
                        |req: Request, next: Next| async move {
                            match req.method() {
                                &Method::PUT | &Method::POST | &Method::PATCH | &Method::DELETE => {
                                    tokio::task::spawn(next.run(req)).await.unwrap()
                                }
                                _ => next.run(req).await,
                            }
                        },
                    )),
            ),
        )
        .nest(
            "/organization",
            organization::router().layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn_with_state(
                        state.clone(),
                        macro_middleware::auth::decode_jwt::handler,
                    ))
                    .layer(axum::middleware::from_fn_with_state(
                        state.clone(),
                        macro_middleware::user_permissions::attach_user_permissions::handler,
                    ))
                    .layer(axum::middleware::from_fn(
                        middleware::ensure_it_permission::handler,
                    ))
                    .layer(axum::middleware::from_fn(
                        |req: Request, next: Next| async move {
                            match req.method() {
                                &Method::PUT | &Method::POST | &Method::PATCH | &Method::DELETE => {
                                    tokio::task::spawn(next.run(req)).await.unwrap()
                                }
                                _ => next.run(req).await,
                            }
                        },
                    )),
            ),
        )
        .nest("/internal", internal::router())
        .with_state(state)
}
