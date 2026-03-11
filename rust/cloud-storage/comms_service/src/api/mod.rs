use crate::api::{activity::post_activity, context::AppState};
use axum::{Router, routing::post};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

pub mod activity;
pub mod attachments;
pub mod channels;
pub mod context;
pub mod extractors;
pub mod mentions;
pub mod middleware;
pub mod preview;
pub mod swagger;

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
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()))
}
