use crate::context::AppState;
use axum::Router;
#[allow(unused_imports)]
pub use connection_gateway_models::{
    BatchSendMessageBody, BatchSendUniqueMessagesBody, SendMessageBody,
};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

mod connection;
mod entities;
mod health;
mod message;
pub(crate) mod swagger;

#[cfg(test)]
mod test;

pub fn router(state: AppState) -> Router {
    Router::new()
        .merge(connection::router())
        .nest("/message", message::router(state.clone()))
        .nest("/track", entities::router(state.clone()))
        .merge(health::router())
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()))
        .with_state(state)
}
