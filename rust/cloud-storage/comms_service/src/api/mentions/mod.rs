use crate::api::context::AppState;
use axum::{
    Router,
    routing::{delete, post},
};
pub use create_mention::*;
pub use delete_mention::*;

pub mod create_mention;
pub mod delete_mention;
mod mentions_middleware;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", post(create_mention_handler))
        .route("/:mention_id", delete(delete_mention_handler))
}
