use crate::api::context::ApiContext;
use axum::Router;
use axum::routing::{delete, get};

pub(crate) mod list;
pub(crate) mod remove;
pub(crate) mod upsert;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/", get(list::handler))
        .route("/:message_id", delete(remove::handler).put(upsert::handler))
}
