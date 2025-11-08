use axum::{
    Router,
    routing::{patch, post},
};

use crate::api::context::AppState;

pub(in crate::api) mod create;
pub(in crate::api) mod initialize_user_experiments;
pub(in crate::api) mod patch;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/initialize", post(initialize_user_experiments::handler))
        .route("/", post(create::handler))
        .route("/", patch(patch::handler))
}
