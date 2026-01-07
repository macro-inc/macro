use axum::{
    Router,
    routing::{get, post},
};

use crate::api::context::AppState;

pub mod get_activity;
pub mod post_activity;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", post(post_activity::post_activity_handler))
        .route("/", get(get_activity::get_activity_handler))
}
