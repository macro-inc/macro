use axum::Router;
use axum::routing::{delete, get};
use crate::api::context::ApiContext;

pub(crate) mod list;
pub(crate) mod remove;
pub(crate) mod upsert;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/", get(list::handler))
        .route("/:message_id", delete(remove::handler).put(upsert::handler))
}