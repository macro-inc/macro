use axum::{Router, routing::get, routing::post};

pub mod get_unfurl;

pub fn router() -> Router {
    Router::new()
        .route("/", get(get_unfurl::get_unfurl_handler))
        .route("/bulk", post(get_unfurl::get_bulk_unfurl_handler))
}
