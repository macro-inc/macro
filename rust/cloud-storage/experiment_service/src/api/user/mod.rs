use axum::{
    Router,
    routing::{get, patch, post},
};

use crate::api::context::AppState;

pub(in crate::api) mod get_active_experiments;
pub(in crate::api) mod set_experiment;
pub(in crate::api) mod update_experiment;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", post(set_experiment::handler))
        .route("/", patch(update_experiment::handler))
        .route("/", get(get_active_experiments::handler))
}
