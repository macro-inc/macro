use crate::api::context::AppState;
use axum::{Router, middleware::from_fn_with_state, routing::IntoMakeService};
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

mod activity;
mod attachments;
mod channels;
pub mod context;
mod extractors;
mod health;
mod internal;
mod mentions;
mod middleware;
mod preview;
mod swagger;

type Service = IntoMakeService<Router>;

pub fn service(app_state: AppState) -> Service {
    let cors = macro_cors::cors_layer();

    let app = Router::new()
        .nest("/activity", activity::router())
        .nest("/channels", channels::router())
        .nest("/preview", preview::router())
        .nest("/attachments", attachments::router())
        .nest("/mentions", mentions::router())
        .layer(from_fn_with_state(
            app_state.jwt_validation_args.clone(),
            middleware::decode_jwt,
        ))
        .nest("/internal", internal::router(app_state.clone()))
        .with_state(app_state)
        .merge(health::router().layer(cors.clone()))
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()))
        .layer(cors.clone())
        .layer(TraceLayer::new_for_http());

    app.into_make_service()
}
