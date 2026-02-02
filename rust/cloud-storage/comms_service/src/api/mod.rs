use crate::api::{activity::post_activity, context::AppState};
use axum::{
    Router,
    middleware::from_fn_with_state,
    routing::{IntoMakeService, post},
};
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

pub mod activity;
pub mod attachments;
pub mod channels;
pub mod context;
pub mod extractors;
pub mod health;
pub mod mentions;
pub mod middleware;
pub mod preview;
pub mod swagger;

type Service = IntoMakeService<Router>;

/// Creates the public comms router.
/// This router contains all public-facing comms endpoints.
/// It does NOT include JWT decoding middleware - that should be applied by the host service.
pub fn router(app_state: &AppState) -> Router<AppState> {
    Router::new()
        .merge(comms::inbound::comms_router(app_state.comms_state.clone()))
        .route("/activity", post(post_activity::post_activity_handler))
        .nest("/channels", channels::router())
        .nest("/preview", preview::router())
        .nest("/attachments", attachments::router())
        .nest("/mentions", mentions::router())
}

/// Creates the full service with all middleware applied (for standalone binary usage).
pub fn service(app_state: AppState) -> Service {
    let cors = macro_cors::cors_layer();

    let app = router(&app_state)
        .layer(from_fn_with_state(
            app_state.jwt_validation_args.clone(),
            middleware::decode_jwt,
        ))
        .with_state(app_state)
        .merge(health::router().layer(cors.clone()))
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()))
        .layer(cors.clone())
        .layer(TraceLayer::new_for_http());

    app.into_make_service()
}
