use crate::context::AppState;
use axum::Router;
use macro_middleware::auth::{attach_user, initialize_user_context};
#[allow(unused_imports)]
pub use message::{BatchSendMessageBody, BatchSendUniqueMessagesBody, SendMessageBody};
use tower::ServiceBuilder;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

mod connection;
mod entities;
mod health;
mod message;
mod swagger;

pub fn router(state: AppState) -> Router {
    Router::new()
        .merge(
            connection::router().layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn(initialize_user_context::handler))
                    .layer(axum::middleware::from_fn_with_state(
                        state.clone(),
                        attach_user::handler,
                    )),
            ),
        )
        .nest("/message", message::router(state.clone()))
        .nest("/track", entities::router(state.clone()))
        .merge(health::router())
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()))
        .with_state(state)
}
