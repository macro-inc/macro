use crate::api::context::{ApiContext, AuthorizationService};
use ::notification_inbound::http::NotificationRouterState;
use anyhow::Context;
use axum::Router;
use macro_tower_layers::MacroRequestIdAndTracingLayer;
use shared_types::version::{ServiceNameState, VersionedApiServiceName, validate_api_version};
use std::time::Duration;
use tower::ServiceBuilder;
use tower_http::compression::CompressionLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

// Utilities
pub mod context;

// Routes
mod health;
mod unsubscribe;
pub(crate) mod user_notification;

pub(crate) mod swagger;

pub async fn setup_and_serve<S: ::notification::domain::service::NotificationReader>(
    state: ApiContext,
    ingress_state: NotificationRouterState<S, AuthorizationService>,
) -> anyhow::Result<()> {
    let port = state.config.port;
    let correlation = state.correlation.clone();
    let env = state.config.environment;
    let app = api_router(state.clone(), ingress_state)
        .with_state(state)
        .layer(axum::middleware::from_fn_with_state(
            correlation,
            agent_correlation::inbound::propagate,
        ))
        .merge(health::router())
        .layer(
            ServiceBuilder::new()
                .layer(MacroRequestIdAndTracingLayer::new(Duration::from_millis(200)).into_inner())
                .layer(axum::middleware::from_fn_with_state(
                    ServiceNameState {
                        service_name: VersionedApiServiceName::NotificationService,
                    },
                    validate_api_version,
                ))
                .layer(macro_cors::cors_layer())
                .layer(CompressionLayer::new().gzip(true)),
        );
    let app = Router::new()
        .merge(app.clone())
        .nest("/notification", app)
        .merge(swagger_ui());

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

fn swagger_ui() -> Router {
    Router::new()
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()))
        .merge(SwaggerUi::new("/notification/docs").url(
            "/notification/api-doc/openapi.json",
            swagger::ApiDoc::openapi(),
        ))
}

fn api_router<S: ::notification::domain::service::NotificationReader>(
    _state: ApiContext,
    ingress_state: NotificationRouterState<S, AuthorizationService>,
) -> Router<ApiContext> {
    let middleware = {
        ServiceBuilder::new().layer(axum::middleware::from_fn(
            macro_middleware::connection_drop_prevention_handler,
        ))
    };

    let internal_router = Router::new()
        .nest(
            "/device",
            ::notification_inbound::http::device::device_router::<S, AuthorizationService>(),
        )
        .nest("/user_notifications", user_notification::router())
        .with_state(ingress_state)
        .nest("/unsubscribe", unsubscribe::router())
        .layer(middleware);
    Router::new()
        .nest("/{version}", internal_router.clone())
        .merge(internal_router)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    /// The router answers an unknown `/{version}` with "404 invalid api
    /// version", so a documented path must use a version the service
    /// accepts, or every client generated from the spec calls a route that
    /// doesn't exist.
    #[test]
    fn documented_paths_use_versions_the_service_accepts() {
        use std::str::FromStr;
        let spec = swagger::ApiDoc::openapi();
        for path in spec.paths.paths.keys() {
            let Some(version) = path
                .strip_prefix('/')
                .and_then(|path| path.split('/').next())
                .filter(|segment| {
                    segment.starts_with('v') && segment[1..].chars().all(|c| c.is_ascii_digit())
                })
            else {
                continue;
            };
            assert!(
                shared_types::version::NotificationServiceApiVersion::from_str(version).is_ok(),
                "{path} is documented under {version}, which the service doesn't serve"
            );
        }
    }

    #[tokio::test]
    async fn openapi_is_served_at_root_and_gateway_prefix() {
        let api = swagger_ui();

        for uri in [
            "/api-doc/openapi.json",
            "/notification/api-doc/openapi.json",
        ] {
            let response = api
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(uri)
                        .method("GET")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();

            assert_eq!(
                response.status(),
                StatusCode::OK,
                "openapi at {uri} should be 200"
            );
        }
    }
}
