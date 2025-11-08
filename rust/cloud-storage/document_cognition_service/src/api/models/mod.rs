pub mod get_models;
use axum::{Router, routing::get};

pub fn router() -> Router {
    Router::new().route("/", get(get_models::get_models_handler))
}
