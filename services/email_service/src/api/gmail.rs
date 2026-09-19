use crate::api::ApiContext;
use axum::Router;
use axum::routing::post;

mod webhook;

pub fn router() -> Router<ApiContext> {
    Router::new().route("/webhook", post(webhook::webhook_handler))
}
