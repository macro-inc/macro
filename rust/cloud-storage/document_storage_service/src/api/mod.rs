use crate::api::context::ApiContext;
use anyhow::Context;
use axum::Router;
use axum::extract::Request;
use axum::http::Method;
use axum::middleware::Next;
use context::InternalFlag;
use macro_axum_utils::compose_layers;
use model::version::{ServiceNameState, VersionedApiServiceName, validate_api_version};
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
mod affiliate;
mod annotations;
mod channel;
mod documents;
mod health;
mod history;
mod instructions;
mod internal;
mod mentions;
mod notification;
mod pins;
mod projects;
mod recents;
mod user;
mod user_document_view_location;

mod items;
mod permissions;
mod swagger;
mod threads;

// Constants
// auth based constants
pub static MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY: &str =
    "x-document-storage-service-auth-key";
pub static MACRO_INTERNAL_USER_ID_HEADER_KEY: &str = "x-document-storage-service-user-id";

// permission based constants
pub static MACRO_READ_PROFESSIONAL_PERMISSION_ID: &str = "read:professional_features";

pub async fn setup_and_serve(state: ApiContext) -> anyhow::Result<()> {
    let cors = macro_cors::cors_layer();

    let app = api_router(state.clone())
        .layer(cors.clone())
        .layer(
            ServiceBuilder::new()
                .layer(TraceLayer::new_for_http())
                .layer(axum::middleware::from_fn_with_state(
                    ServiceNameState {
                        service_name: VersionedApiServiceName::DocumentStorageService,
                    },
                    validate_api_version,
                )),
        )
        // The health router is attached here so we don't attach the logging middleware to it
        .merge(health::router().layer(cors))
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
    let internal_router = Router::new()
        .nest("/affiliate", affiliate::router(state.clone()))
        .nest(
            "/documents",
            documents::router(state.clone()).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn(macro_middleware::connection_drop_prevention_handler),
            )),
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
        .nest("/mentions", mentions::router(state.clone()))
        .nest(
            "/annotations",
            annotations::router(state.clone()).layer(axum::middleware::from_fn(
                macro_middleware::connection_drop_prevention_handler,
            )),
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
        .nest("/:version", internal_router.clone())
        .merge(internal_router)
}
