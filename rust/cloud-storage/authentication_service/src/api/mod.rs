use crate::api::context::ApiContext;
use anyhow::Context;
use axum::Router;
use axum::http::HeaderName;
use macro_auth::constant::MACRO_REFRESH_TOKEN_HEADER;
use macro_tower_layers::MacroRequestIdAndTracingLayer;
use native_app_service::inbound::RouterState;
use std::time::Duration;
use tower::ServiceBuilder;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

// Utilities
pub(crate) mod context;

// Routes
#[allow(unused_imports)]
mod email;
mod link;
#[allow(unused_imports)]
mod merge;

mod health;
mod internal;
mod jwt;
mod login;
mod logout;
mod oauth;
mod oauth2;
mod permissions;
mod session;
mod user;
mod webhooks;

// Misc
mod middleware;
pub(crate) mod swagger;
mod utils;

pub async fn setup_and_serve(state: ApiContext, port: usize) -> anyhow::Result<()> {
    let cors = macro_cors::cors_layer_with_headers(vec![HeaderName::from_static(
        MACRO_REFRESH_TOKEN_HEADER,
    )]);

    let env = state.environment;

    let app = api_router(state.clone())
        .with_state(state)
        .layer(MacroRequestIdAndTracingLayer::new(Duration::from_millis(200)).into_inner())
        // The health router is attached here so we don't attach the logging middleware to it
        .merge(health::router())
        .layer(cors)
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()));

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .unwrap();
    tracing::info!(
        "authentication service is up and running with environment {:?} on port {}",
        &env,
        &port
    );
    axum::serve(listener, app.into_make_service())
        .await
        .context("error starting service")
}

fn api_router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .merge(native_app_service::inbound::native_app_router(
            RouterState {
                inner: state.native_app_service.clone(),
            },
        ))
        .nest("/internal", internal::router())
        .nest("/permissions", permissions::router(state.jwt_args.clone()))
        .nest("/login", login::router(state.clone()))
        .nest("/logout", logout::router(state.jwt_args.clone()))
        .nest("/oauth", oauth::router(state.clone()))
        .nest("/oauth2", oauth2::router())
        .nest("/user", user::router(state.clone(), state.jwt_args.clone()))
        .nest(
            "/link",
            link::router(state.clone()).layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn(
                        macro_middleware::tracking::attach_ip_context_handler,
                    ))
                    .layer(axum::middleware::from_fn_with_state(
                        state.jwt_args.clone(),
                        macro_middleware::auth::decode_jwt::handler,
                    )),
            ),
        )
        .nest(
            "/team",
            teams::inbound::axum_router::teams_router(
                teams::inbound::axum_router::TeamRouterState {
                    service: state.teams_service.clone(),
                },
            )
            .layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn(
                        macro_middleware::tracking::attach_ip_context_handler,
                    ))
                    .layer(axum::middleware::from_fn_with_state(
                        state.jwt_args.clone(),
                        macro_middleware::auth::decode_jwt::handler,
                    )),
            ),
        )
        .nest("/jwt", jwt::router(state.jwt_args.clone()))
        .nest("/session", session::router())
        .nest(
            "/webhooks",
            webhooks::router().layer(ServiceBuilder::new().layer(axum::middleware::from_fn(
                macro_middleware::connection_drop_prevention_handler,
            ))),
        )
}
