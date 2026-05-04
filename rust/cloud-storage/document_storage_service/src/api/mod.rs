use crate::api::context::ApiContext;
use anyhow::Context;
use axum::Router;
use axum::extract::FromRef;
use axum::extract::Request;
use axum::http::Method;
use axum::middleware::Next;
use comms_service::CommsHandlerState;
use context::InternalFlag;
use github::inbound::github_sync_router::GithubSyncRouterState;
use macro_axum_utils::compose_layers;
use model::version::{ServiceNameState, VersionedApiServiceName, validate_api_version};
use properties_service::PropertiesHandlerState;
use search_service::SearchHandlerState;
use tower::ServiceBuilder;
use tower_http::compression::CompressionLayer;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

// Utilities
pub(crate) mod context;
mod saved_views;
mod util;

// Middleware
mod middleware;

// Routes
mod activity;
mod annotations;
mod documents;
mod health;
mod history;
mod instructions;
mod internal;
mod notification;
mod pins;
mod projects;
mod recents;
mod user;
mod user_document_view_location;

mod entity;
mod items;
pub(crate) mod swagger;
mod threads;

// Constants
// auth based constants
pub static MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY: &str =
    "x-document-storage-service-auth-key";
pub static MACRO_INTERNAL_USER_ID_HEADER_KEY: &str = "x-document-storage-service-user-id";

pub const MACRO_INTERNAL_USER_ID: &str = "macro|INTERNAL@macro.com";
// permission based constants
pub static MACRO_READ_PROFESSIONAL_PERMISSION_ID: &str = "read:professional_features";

pub async fn setup_and_serve(state: ApiContext) -> anyhow::Result<()> {
    let app = api_router(state.clone())
        .merge(health::router())
        .layer(
            ServiceBuilder::new()
                .layer(TraceLayer::new_for_http())
                .layer(axum::middleware::from_fn_with_state(
                    ServiceNameState {
                        service_name: VersionedApiServiceName::DocumentStorageService,
                    },
                    validate_api_version,
                ))
                .layer(macro_cors::cors_layer())
                .layer(CompressionLayer::new().gzip(true)),
        )
        // The health router is attached here so we don't attach the logging middleware to it
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()));

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", state.config.port))
        .await
        .unwrap();
    tracing::info!(
        "document storage service is up and running with environment {:?} on port {}",
        &state.config.environment,
        &state.config.port
    );
    axum::serve(listener, app.into_make_service())
        .await
        .context("error starting service")
}

fn api_router(state: ApiContext) -> Router {
    let github_sync_service_router_state = GithubSyncRouterState {
        service: state.github_sync_service.clone(),
    };

    // Webhook router is outside auth — LiveKit validates via its own JWT,
    // cal.com validates via HMAC signature.
    let webhook_router = Router::new()
        .nest(
            "/call",
            call::inbound::axum_router::webhook_router(state.call_webhook_state.clone()),
        )
        .nest(
            "/cal",
            cal::inbound::cal_webhook_router::cal_webhook_router(state.cal_webhook_state.clone()),
        );

    // Internal call router — agent-authenticated via x-macro-internal-call header.
    let internal_call_router = Router::new().nest(
        "/call",
        call::inbound::axum_router::internal_call_router(state.call_internal_state.clone()),
    );

    let internal_router = Router::new()
        .nest(
            "/github",
            github::inbound::github_sync_router::github_sync_router(
                github_sync_service_router_state,
            ),
        )
        .nest(
            "/documents",
            documents::router(state.clone())
                .merge(documents_hex::inbound::axum_router::documents_router(
                    state.documents_state.clone(),
                ))
                .layer(ServiceBuilder::new().layer(axum::middleware::from_fn(
                    macro_middleware::connection_drop_prevention_handler,
                ))),
        )
        .nest(
            "/history",
            history::router().layer(compose_layers![
                axum::middleware::from_fn(macro_middleware::connection_drop_prevention_handler),
                CompressionLayer::new(),
            ]),
        )
        .nest("/instructions", instructions::router())
        .nest(
            "/items",
            soup::inbound::axum_router::soup_router(state.soup_router_state.clone()),
        )
        .nest(
            "/threads",
            threads::router(state.clone()).layer(axum::middleware::from_fn(
                macro_middleware::connection_drop_prevention_handler,
            )),
        )
        .nest(
            "/user_document_view_location",
            user_document_view_location::router(state.clone()).layer(axum::middleware::from_fn(
                macro_middleware::connection_drop_prevention_handler,
            )),
        )
        .nest("/activity", activity::router())
        .nest(
            "/pins",
            pins::router().layer(axum::middleware::from_fn(
                macro_middleware::connection_drop_prevention_handler,
            )),
        )
        .nest(
            "/projects",
            projects::router(state.clone()).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn(|req: Request, next: Next| async move {
                    match req.method() {
                        &Method::PUT | &Method::POST | &Method::PATCH | &Method::DELETE => {
                            let uri = req.uri().to_string();
                            // We do not want the upload a folder in the background
                            // If a user cancels the call we need to make sure we aren't
                            // creating documents/projects
                            if !uri.contains("/upload") {
                                return next.run(req).await;
                            }
                            tokio::task::spawn(next.run(req)).await.unwrap()
                        }
                        _ => next.run(req).await,
                    }
                }),
            )),
        )
        .nest(
            "/annotations",
            annotations::router(state.clone()).layer(axum::middleware::from_fn(
                macro_middleware::connection_drop_prevention_handler,
            )),
        )
        .nest(
            "/properties",
            properties_service::properties_router()
                .with_state(PropertiesHandlerState::from_ref(&state)),
        )
        .nest(
            "/search",
            search_service::search_router().with_state(SearchHandlerState::from_ref(&state)),
        )
        .nest(
            "/comms",
            comms_service::comms_router(&CommsHandlerState::from_ref(&state))
                .with_state(CommsHandlerState::from_ref(&state)),
        )
        .nest("/entity", entity::router())
        .nest(
            "/channels",
            channels::inbound::axum_router::channels_router(state.channels_state.clone()),
        )
        .nest(
            "/call",
            call::inbound::axum_router::call_router(state.call_state.clone()),
        )
        .layer(
            ServiceBuilder::new()
                .layer(axum::middleware::from_fn(
                    macro_middleware::auth::initialize_user_context::handler,
                ))
                .layer(axum::middleware::from_fn_with_state(
                    state.jwt_validation_args.clone(),
                    macro_middleware::auth::attach_user::handler,
                )),
        )
        .nest(
            "/internal",
            internal::router(state.clone())
                .nest("/notifications", notification::router())
                .nest(
                    "/search",
                    search_service::search_router()
                        .with_state(SearchHandlerState::from_ref(&state)),
                )
                .nest(
                    "/sync_service",
                    sync_service_hex::inbound::axum_router::sync_service_router(
                        sync_service_hex::inbound::axum_router::SyncServiceRouterState {
                            service: state.sync_service_client.clone(),
                        },
                    ),
                )
                .layer(
                    ServiceBuilder::new()
                        .layer(axum::middleware::from_fn_with_state(
                            state.clone(),
                            middleware::internal_access::handler,
                        ))
                        .layer(axum::middleware::from_fn(
                            macro_middleware::connection_drop_prevention_handler,
                        ))
                        .layer(axum::middleware::from_fn(
                            |mut req: Request, next: Next| async move {
                                req.extensions_mut().insert(InternalFlag { internal: true });
                                next.run(req).await
                            },
                        )),
                ),
        )
        .nest(
            "/recents",
            recents::router().layer(axum::middleware::from_fn_with_state(
                state.clone(),
                macro_middleware::auth::decode_jwt::handler, // The user has to exist for all recents calls
            )),
        )
        .nest(
            "/saved_views",
            saved_views::router().layer(compose_layers![
                axum::middleware::from_fn(macro_middleware::auth::initialize_user_context::handler),
                axum::middleware::from_fn_with_state(
                    state.clone(),
                    macro_middleware::auth::attach_user::handler
                ),
            ]),
        )
        .with_state(state);
    Router::new()
        .nest("/{version}", internal_router.clone())
        .merge(internal_router)
        .merge(webhook_router)
        .merge(internal_call_router)
}
