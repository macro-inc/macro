use crate::api::context::ApiContext;
use ::notification::inbound::http::NotificationRouterState;
use anyhow::Context;
use axum::Router;
use macro_middleware::auth::internal_access::ValidInternalKey;
use model::version::{ServiceNameState, VersionedApiServiceName, validate_api_version};
use tower::ServiceBuilder;
use tower_http::{compression::CompressionLayer, trace::TraceLayer};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

// Utilities
pub mod context;

// Routes
mod device;
mod health;
mod notification;
mod unsubscribe;
pub(crate) mod user_notification;

pub(crate) mod swagger;

pub async fn setup_and_serve<S: ::notification::domain::service::NotificationReader>(
    state: ApiContext,
    ingress_state: NotificationRouterState<S>,
) -> anyhow::Result<()> {
    let port = state.config.port;
    let env = state.config.environment;
    let app = api_router(state.clone(), ingress_state)
        .with_state(state)
        .merge(health::router())
        .layer(
            ServiceBuilder::new()
                .layer(TraceLayer::new_for_http())
                .layer(axum::middleware::from_fn_with_state(
                    ServiceNameState {
                        service_name: VersionedApiServiceName::NotificationService,
                    },
                    validate_api_version,
                ))
                .layer(macro_cors::cors_layer())
                .layer(CompressionLayer::new().gzip(true)),
        )
        // The health router is attached here so we don't attach the logging middleware to it
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()));

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .unwrap();
    tracing::info!(
        "notification service is up and running with environment {:?} on port {}",
        &env,
        &port
    );
    axum::serve(listener, app.into_make_service())
        .await
        .context("error starting service")
}

fn api_router<S: ::notification::domain::service::NotificationReader>(
    state: ApiContext,
    ingress_state: NotificationRouterState<S>,
) -> Router<ApiContext> {
    let middleware = {
        ServiceBuilder::new()
            .layer(axum::middleware::from_fn_with_state(
                state.jwt_args.clone(),
                macro_middleware::auth::decode_jwt::handler,
            ))
            .layer(axum::middleware::from_fn(
                macro_middleware::connection_drop_prevention_handler,
            ))
    };

    let internal_router = Router::new()
        .nest("/device", device::router())
        .nest(
            "/user_notifications",
            user_notification::router(ingress_state),
        )
        .nest("/unsubscribe", unsubscribe::router())
        .layer(middleware)
        .nest(
            "/notifications",
            notification::router().layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_extractor_with_state::<
                        ValidInternalKey,
                        _,
                    >(state))
                    .layer(axum::middleware::from_fn(
                        macro_middleware::connection_drop_prevention_handler,
                    )),
            ),
        );
    Router::new()
        .nest("/:version", internal_router.clone())
        .merge(internal_router)
}
